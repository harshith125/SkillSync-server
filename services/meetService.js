const crypto = require('crypto');
const { sendEmail } = require('./emailService');

/**
 * Generate a standard Google Meet room code (xxx-yyyy-zzz)
 * Format matches Google Meet standards: 3 letters - 4 letters - 3 letters
 */
const generateGoogleMeetLink = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const randPart = (len) => {
        let res = '';
        for (let i = 0; i < len; i++) {
            res += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        return res;
    };
    const code = `${randPart(3)}-${randPart(4)}-${randPart(3)}`;
    return `https://meet.google.com/${code}`;
};

/**
 * Send meeting invitation to a list of candidates
 */
const sendMeetingInvitations = async ({ job, title, description, meetLink, date, time, stage, candidates }) => {
    if (!candidates || candidates.length === 0) {
        return { count: 0, msg: 'No candidates in selected stage' };
    }

    const formattedDate = new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let sentCount = 0;

    for (const candidate of candidates) {
        if (!candidate.email) continue;

        const candidateName = candidate.fullName || 'Candidate';
        const subject = `[SkillSync] Meeting Invitation: ${title} - ${job.companyName}`;

        const html = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #334155;">
            <div style="background: linear-gradient(135deg, #4f46e5, #9333ea); padding: 32px 24px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px; color: #ffffff; letter-spacing: 0.5px;">SkillSync Meeting Invitation</h1>
                <p style="margin: 8px 0 0 0; color: #e0e7ff; font-size: 15px;">Session with ${job.companyName}</p>
            </div>
            
            <div style="padding: 28px 24px;">
                <p style="font-size: 16px; color: #e2e8f0; margin-top: 0;">Hello <strong>${candidateName}</strong>,</p>
                <p style="color: #cbd5e1; line-height: 1.6;">
                    You are invited to an online meeting for the role of <strong>${job.title}</strong> at <strong>${job.companyName}</strong>.
                    ${stage && stage !== 'All' ? `<br/><em>Selection Stage: <strong>${stage}</strong></em>` : ''}
                </p>

                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #475569;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #e2e8f0;">
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8; width: 120px;">📌 <strong>Session:</strong></td>
                            <td style="padding: 8px 0;"><strong>${title}</strong></td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">📅 <strong>Date:</strong></td>
                            <td style="padding: 8px 0;">${formattedDate}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">⏰ <strong>Time:</strong></td>
                            <td style="padding: 8px 0;">${time}</td>
                        </tr>
                        ${description ? `
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8; vertical-align: top;">📝 <strong>Agenda:</strong></td>
                            <td style="padding: 8px 0;">${description}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${meetLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb, #4f46e5); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">
                        🎥 Join Google Meet
                    </a>
                    <p style="margin-top: 12px; font-size: 13px; color: #94a3b8;">
                        Direct Link: <a href="${meetLink}" style="color: #60a5fa;">${meetLink}</a>
                    </p>
                </div>

                <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; border-top: 1px solid #334155; padding-top: 16px;">
                    💡 <em>Please join 5 minutes early with your camera and microphone ready.</em>
                </p>
            </div>

            <div style="background: #090d16; padding: 16px; text-align: center; font-size: 12px; color: #64748b;">
                SkillSync Automated Notification • Connecting Talent with Opportunities
            </div>
        </div>
        `;

        try {
            await sendEmail(candidate.email, subject, html);
            sentCount++;
        } catch (err) {
            console.error(`Failed to send invite to ${candidate.email}:`, err.message);
        }
    }

    return { count: sentCount, msg: `Successfully sent invites to ${sentCount} candidate(s)` };
};

module.exports = {
    generateGoogleMeetLink,
    sendMeetingInvitations
};
