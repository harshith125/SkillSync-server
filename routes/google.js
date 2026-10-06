const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const User = require('../models/User');
const {
    getAuthUrl,
    getTokensFromCode,
    getGoogleProfile,
    createCalendarInterviewEvent
} = require('../services/googleService');

const CLIENT_BASE_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// @route   GET api/google/auth
// @desc    Initiate Google OAuth 2.0 flow
// @access  Public (accepts token via query or header)
router.get('/auth', async (req, res) => {
    try {
        const token = req.query.token || req.header('x-auth-token');
        if (!token) {
            return res.status(401).json({ msg: 'Authentication token required to connect Google account' });
        }

        // Verify token to ensure user identity
        let userId = null;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secretKey');
            userId = decoded.user?.id || decoded.id;
        } catch (jwtErr) {
            return res.status(401).json({ msg: 'Invalid or expired session token' });
        }

        if (!userId) {
            return res.status(401).json({ msg: 'User ID could not be identified from token' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        // Require SkillSync PRO subscription to connect Google Calendar
        if (!user.isPro) {
            if (req.query.redirect === 'true') {
                return res.redirect(`${CLIENT_BASE_URL}/subscription?error=pro_required`);
            }
            return res.status(403).json({
                msg: 'SkillSync PRO subscription required to connect Google Calendar.',
                requiresPro: true,
                redirectUrl: '/subscription'
            });
        }

        // Generate authorization URL passing token/userId in state
        const authUrl = getAuthUrl(token);

        // If requested via browser redirect or json
        if (req.query.redirect === 'true') {
            return res.redirect(authUrl);
        }

        res.json({ url: authUrl });
    } catch (err) {
        console.error('[Google Auth Error]:', err);
        res.status(500).json({ msg: 'Failed to initiate Google authorization', error: err.message });
    }
});

// @route   GET api/google/callback
// @desc    Google OAuth 2.0 Callback endpoint
// @access  Public (called by Google OAuth)
// OAuth Redirect URI: http://localhost:5000/api/google/callback
router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    // Handle user denial or Google OAuth errors
    if (error) {
        console.warn('[Google OAuth Callback Warning]: User denied or Google error:', error);
        return res.redirect(`${CLIENT_BASE_URL}/dashboard?google_error=${encodeURIComponent(error)}`);
    }

    if (!code) {
        return res.redirect(`${CLIENT_BASE_URL}/dashboard?google_error=missing_authorization_code`);
    }

    try {
        // Decode user from state parameter
        let userId = null;
        try {
            const decoded = jwt.verify(state, process.env.JWT_SECRET || 'secretKey');
            userId = decoded.user?.id || decoded.id;
        } catch (stateErr) {
            // Fallback in case state was passed as plain string
            userId = state;
        }

        if (!userId) {
            console.error('[Google OAuth Error]: State parameter could not be decoded to user ID');
            return res.redirect(`${CLIENT_BASE_URL}/dashboard?google_error=invalid_state`);
        }

        const user = await User.findById(userId);
        if (!user) {
            console.error(`[Google OAuth Error]: User not found for ID: ${userId}`);
            return res.redirect(`${CLIENT_BASE_URL}/dashboard?google_error=user_not_found`);
        }

        // Exchange authorization code for tokens
        const tokens = await getTokensFromCode(code);

        // Retrieve connected Google account email
        let googleEmail = null;
        try {
            const profile = await getGoogleProfile(tokens);
            googleEmail = profile?.email || null;
        } catch (profileErr) {
            console.warn('[Google OAuth]: Could not fetch profile details:', profileErr.message);
        }

        // Securely store credentials on backend User document
        user.isGoogleConnected = true;
        user.googleTokens = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || user.googleTokens?.refresh_token, // Preserve existing refresh token if not reissued
            scope: tokens.scope,
            token_type: tokens.token_type,
            expiry_date: tokens.expiry_date,
            googleEmail: googleEmail
        };

        await user.save();
        console.log(`[Google OAuth]: Successfully connected Google account (${googleEmail || 'N/A'}) for user ${user.email}`);

        // Redirect back to frontend dashboard with success notification
        res.redirect(`${CLIENT_BASE_URL}/dashboard?google_connected=true`);

    } catch (err) {
        console.error('[Google OAuth Callback Fatal Error]:', err);
        const errMsg = err.message || 'unknown_callback_error';
        res.redirect(`${CLIENT_BASE_URL}/dashboard?google_error=${encodeURIComponent(errMsg)}`);
    }
});

// @route   GET api/google/status
// @desc    Get Google Calendar connection status for logged-in user
// @access  Private
router.get('/status', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('isGoogleConnected googleTokens email');
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const isConnected = Boolean(
            user.isGoogleConnected &&
            user.googleTokens &&
            (user.googleTokens.access_token || user.googleTokens.refresh_token)
        );

        res.json({
            isConnected,
            googleEmail: user.googleTokens?.googleEmail || null,
            expiryDate: user.googleTokens?.expiry_date || null
        });
    } catch (err) {
        console.error('[Google Status Error]:', err);
        res.status(500).json({ msg: 'Server error retrieving Google status' });
    }
});

// @route   DELETE api/google/disconnect
// @desc    Disconnect Google Calendar integration
// @access  Private
router.delete('/disconnect', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        user.isGoogleConnected = false;
        user.googleTokens = undefined;
        await user.save();

        res.json({ success: true, msg: 'Google Calendar successfully disconnected' });
    } catch (err) {
        console.error('[Google Disconnect Error]:', err);
        res.status(500).json({ msg: 'Server error disconnecting Google account' });
    }
});

// @route   POST api/google/calendar-event
// @desc    Create Google Calendar event with auto-generated Google Meet link
// @access  Private
router.post('/calendar-event', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        if (!user.isGoogleConnected || !user.googleTokens) {
            return res.status(400).json({
                msg: 'Google Calendar is not connected. Please connect your Google account first.'
            });
        }

        const { title, description, startTime, endTime, timeZone, attendees } = req.body;

        if (!title || !startTime) {
            return res.status(400).json({ msg: 'Meeting title and start time are required.' });
        }

        // Include interviewer email in attendees if not present
        const attendeeList = Array.isArray(attendees) ? [...attendees] : [];
        if (user.googleTokens.googleEmail && !attendeeList.includes(user.googleTokens.googleEmail)) {
            attendeeList.push(user.googleTokens.googleEmail);
        }

        const eventResult = await createCalendarInterviewEvent({
            user,
            title,
            description,
            startTime,
            endTime,
            timeZone: timeZone || 'Asia/Kolkata',
            attendees: attendeeList
        });

        res.json({
            success: true,
            msg: 'Calendar event created with Google Meet conference!',
            ...eventResult
        });

    } catch (err) {
        console.error('[Google Calendar Event Creation Error]:', err);
        res.status(500).json({
            msg: 'Failed to create Google Calendar event: ' + err.message,
            error: err.message
        });
    }
});

module.exports = router;
