const { google } = require('googleapis');
const User = require('../models/User');

const getOAuth2Client = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/google/callback';

    if (!clientId || !clientSecret) {
        console.warn('[GoogleService] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in environment variables.');
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

// Required Google OAuth Scopes for Calendar & Google Meet creation
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

/**
 * Generate Google OAuth 2.0 authorization URL
 * @param {string} state - Token or serialized state to identify user on callback
 */
const getAuthUrl = (state) => {
    const oauth2Client = getOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Required for receiving refresh_token
        prompt: 'consent',     // Ensures consent screen is shown and refresh_token is returned
        scope: SCOPES,
        state
    });
};

/**
 * Exchange authorization code for access & refresh tokens
 */
const getTokensFromCode = async (code) => {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
};

/**
 * Get Google user profile details (email) using tokens
 */
const getGoogleProfile = async (tokens) => {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    return data;
};

/**
 * Initialize authenticated Google Calendar API client for a user
 * Automatically handles token refresh and updates DB
 */
const getAuthenticatedCalendarClient = async (user) => {
    if (!user.googleTokens || (!user.googleTokens.access_token && !user.googleTokens.refresh_token)) {
        throw new Error('Google Calendar is not connected for this account.');
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: user.googleTokens.access_token,
        refresh_token: user.googleTokens.refresh_token,
        expiry_date: user.googleTokens.expiry_date
    });

    // Listen for automatic token refresh events and save updated tokens in MongoDB
    oauth2Client.on('tokens', async (newTokens) => {
        try {
            const updatedUser = await User.findById(user._id);
            if (updatedUser) {
                if (newTokens.access_token) {
                    updatedUser.googleTokens.access_token = newTokens.access_token;
                }
                if (newTokens.refresh_token) {
                    updatedUser.googleTokens.refresh_token = newTokens.refresh_token;
                }
                if (newTokens.expiry_date) {
                    updatedUser.googleTokens.expiry_date = newTokens.expiry_date;
                }
                await updatedUser.save();
                console.log(`[GoogleService] Updated refreshed tokens for user: ${user.email}`);
            }
        } catch (saveErr) {
            console.error('[GoogleService] Error persisting refreshed tokens:', saveErr);
        }
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
};

/**
 * Create a Google Calendar event with auto-generated Google Meet conference
 */
const createCalendarInterviewEvent = async ({
    user,
    title,
    description = '',
    startTime,
    endTime,
    timeZone = 'Asia/Kolkata',
    attendees = []
}) => {
    const calendar = await getAuthenticatedCalendarClient(user);

    // Ensure valid start and end dates
    const startIso = new Date(startTime).toISOString();
    // Default duration: 45 minutes if endTime not provided
    const endIso = endTime
        ? new Date(endTime).toISOString()
        : new Date(new Date(startTime).getTime() + 45 * 60 * 1000).toISOString();

    const formattedAttendees = attendees
        .filter(email => email && typeof email === 'string')
        .map(email => ({ email: email.trim() }));

    const eventPayload = {
        summary: title,
        description: description,
        start: {
            dateTime: startIso,
            timeZone: timeZone
        },
        end: {
            dateTime: endIso,
            timeZone: timeZone
        },
        attendees: formattedAttendees,
        conferenceData: {
            createRequest: {
                requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                conferenceSolutionKey: {
                    type: 'hangoutsMeet'
                }
            }
        }
    };

    const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: eventPayload,
        conferenceDataVersion: 1, // Required to trigger Google Meet conference creation
        sendUpdates: 'all'        // Google automatically sends calendar invite emails to attendees
    });

    const createdEvent = response.data;
    const meetLink = createdEvent.hangoutLink ||
        (createdEvent.conferenceData && createdEvent.conferenceData.entryPoints
            ? createdEvent.conferenceData.entryPoints.find(p => p.entryPointType === 'video')?.uri
            : null);

    return {
        eventId: createdEvent.id,
        meetLink: meetLink,
        htmlLink: createdEvent.htmlLink,
        status: createdEvent.status,
        summary: createdEvent.summary,
        start: createdEvent.start,
        end: createdEvent.end
    };
};

module.exports = {
    getOAuth2Client,
    getAuthUrl,
    getTokensFromCode,
    getGoogleProfile,
    getAuthenticatedCalendarClient,
    createCalendarInterviewEvent,
    SCOPES
};
