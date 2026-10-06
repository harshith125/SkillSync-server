const cron = require('node-cron');
const Job = require('../models/Job');
const Application = require('../models/Application');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

/**
 * Format and send the Leaderboard email to the recruiter
 */
const sendLeaderboardEmail = async (job, applications, reason = 'expired') => {
    try {
        const companyUser = await User.findById(job.company);
        if (!companyUser || !companyUser.email) {
            console.log('Company email not found for job:', job._id);
            return false;
        }

        // Sort applications by AI score descending
        const rankedApplications = [...applications].sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));
        const totalCount = rankedApplications.length;

        // Build HTML table rows for each applicant
        let tableRowsHtml = '';
        if (totalCount === 0) {
            tableRowsHtml = `
            <tr>
                <td colspan="6" style="padding: 24px; text-align: center; color: #94a3b8; font-style: italic;">
                    No candidates applied for this job opening before closing.
                </td>
            </tr>`;
        } else {
            rankedApplications.forEach((app, idx) => {
                const rank = idx + 1;
                const candidate = app.candidate || {};
                const candidateName = candidate.fullName || 'Candidate';
                const candidateEmail = candidate.email || 'N/A';
                const candidateMobile = candidate.mobile || 'N/A';
                const score = app.aiScore || 0;
                const skills = (candidate.skills || []).slice(0, 4).join(', ') || 'N/A';
                const summary = app.aiSummary || 'Evaluated based on profile skills & experience.';
                const resumeLink = app.customResume || candidate.resume || '';

                // Medal or color badge for top candidates
                let rankBadge = `<span style="font-weight: bold; color: #94a3b8;">#${rank}</span>`;
                if (rank === 1) rankBadge = `<span style="background: #eab308; color: #000; padding: 3px 8px; border-radius: 999px; font-weight: bold; font-size: 11px;">🥇 #1 Best</span>`;
                else if (rank === 2) rankBadge = `<span style="background: #94a3b8; color: #000; padding: 3px 8px; border-radius: 999px; font-weight: bold; font-size: 11px;">🥈 #2</span>`;
                else if (rank === 3) rankBadge = `<span style="background: #cd7f32; color: #fff; padding: 3px 8px; border-radius: 999px; font-weight: bold; font-size: 11px;">🥉 #3</span>`;

                const scoreColor = score >= 80 ? '#22c55e' : (score >= 60 ? '#38bdf8' : '#eab308');

                tableRowsHtml += `
                <tr style="border-bottom: 1px solid #334155; ${rank === 1 ? 'background: rgba(99, 102, 241, 0.08);' : ''}">
                    <td style="padding: 14px 10px; text-align: center;">${rankBadge}</td>
                    <td style="padding: 14px 10px;">
                        <strong style="color: #ffffff; font-size: 14px;">${candidateName}</strong><br/>
                        <span style="font-size: 12px; color: #94a3b8;">${candidateEmail}</span>
                        ${candidateMobile !== 'N/A' ? `<br/><span style="font-size: 11px; color: #64748b;">📞 ${candidateMobile}</span>` : ''}
                    </td>
                    <td style="padding: 14px 10px; text-align: center;">
                        <span style="font-size: 16px; font-weight: bold; color: ${scoreColor};">${score}%</span>
                    </td>
                    <td style="padding: 14px 10px; font-size: 12px; color: #cbd5e1; max-width: 140px;">
                        ${skills}
                    </td>
                    <td style="padding: 14px 10px; font-size: 12px; color: #94a3b8; max-width: 200px; line-height: 1.4;">
                        ${summary}
                    </td>
                    <td style="padding: 14px 10px; text-align: center;">
                        ${resumeLink ? `<a href="${resumeLink}" target="_blank" style="display: inline-block; background: #3b82f6; color: #fff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;">Resume</a>` : `<span style="color: #64748b; font-size: 11px;">None</span>`}
                    </td>
                </tr>`;
            });
        }

        const reasonText = reason === 'expired'
            ? 'The application deadline for this job posting has arrived, and it has been automatically closed.'
            : 'You have manually closed this job opening.';

        const subject = `[SkillSync] Job Closed & Candidate Leaderboard: ${job.title} (${totalCount} Applicants)`;

        const html = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 780px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #334155;">
            <div style="background: linear-gradient(135deg, #1e3a8a, #4338ca); padding: 32px 24px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px; color: #ffffff;">Job Closed & Candidate Leaderboard</h1>
                <p style="margin: 8px 0 0 0; color: #e0e7ff; font-size: 15px;">Role: <strong>${job.title}</strong> • ${job.companyName}</p>
            </div>

            <div style="padding: 28px 24px;">
                <p style="font-size: 15px; color: #e2e8f0; margin-top: 0;">
                    Hello <strong>${companyUser.companyName || 'Recruiter'}</strong>,
                </p>
                <p style="color: #cbd5e1; line-height: 1.6; margin-bottom: 20px;">
                    ${reasonText} We analyzed all received applications using SkillSync AI and ranked the candidates from top best-match (#1) to least.
                </p>

                <!-- Metrics Summary Cards -->
                <div style="display: flex; gap: 12px; margin-bottom: 24px;">
                    <div style="flex: 1; background: #1e293b; padding: 16px; border-radius: 10px; border: 1px solid #475569; text-align: center;">
                        <div style="font-size: 26px; font-weight: bold; color: #60a5fa;">${totalCount}</div>
                        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-top: 4px;">Total Applicants</div>
                    </div>
                    <div style="flex: 1; background: #1e293b; padding: 16px; border-radius: 10px; border: 1px solid #475569; text-align: center;">
                        <div style="font-size: 26px; font-weight: bold; color: #22c55e;">
                            ${totalCount > 0 ? (rankedApplications[0].aiScore || 0) + '%' : 'N/A'}
                        </div>
                        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-top: 4px;">Top Match Score</div>
                    </div>
                    <div style="flex: 1; background: #1e293b; padding: 16px; border-radius: 10px; border: 1px solid #475569; text-align: center;">
                        <div style="font-size: 26px; font-weight: bold; color: #a855f7;">
                            ${totalCount > 0 ? rankedApplications.filter(a => (a.aiScore || 0) >= 70).length : 0}
                        </div>
                        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-top: 4px;">High Potential (≥70%)</div>
                    </div>
                </div>

                <!-- Leaderboard Table -->
                <h3 style="color: #ffffff; font-size: 18px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    🏆 Candidate Ranking Leaderboard
                </h3>
                
                <div style="overflow-x: auto; background: #1e293b; border-radius: 12px; border: 1px solid #475569;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: #0f172a; border-bottom: 2px solid #334155; color: #94a3b8; font-size: 12px; text-transform: uppercase;">
                                <th style="padding: 12px 10px; text-align: center; width: 60px;">Rank</th>
                                <th style="padding: 12px 10px;">Candidate</th>
                                <th style="padding: 12px 10px; text-align: center; width: 70px;">Match</th>
                                <th style="padding: 12px 10px;">Key Skills</th>
                                <th style="padding: 12px 10px;">AI Fit Summary</th>
                                <th style="padding: 12px 10px; text-align: center; width: 80px;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <p style="font-size: 13px; color: #94a3b8;">
                        You can also manage stages, view profiles, and schedule follow-up interviews directly in your SkillSync dashboard.
                    </p>
                </div>
            </div>

            <div style="background: #090d16; padding: 16px; text-align: center; font-size: 12px; color: #64748b;">
                SkillSync Automated Job Engine • Powered by Google Gemini AI
            </div>
        </div>
        `;

        await sendEmail(companyUser.email, subject, html);
        console.log(`Leaderboard email dispatched to ${companyUser.email} for job "${job.title}"`);
        return true;
    } catch (err) {
        console.error('Error generating/sending leaderboard email:', err);
        return false;
    }
};

/**
 * Close a job and trigger leaderboard generation
 */
const closeJobAndNotify = async (jobId, reason = 'manual') => {
    try {
        const job = await Job.findById(jobId);
        if (!job) return { success: false, msg: 'Job not found' };

        job.status = reason === 'expired' ? 'expired' : 'closed';
        await job.save();

        const applications = await Application.find({ job: jobId })
            .populate('candidate', ['fullName', 'email', 'mobile', 'skills', 'experience', 'resume', 'education']);

        if (!job.leaderboardSent) {
            await sendLeaderboardEmail(job, applications, reason);
            job.leaderboardSent = true;
            await job.save();
        }

        return { success: true, count: applications.length };
    } catch (err) {
        console.error('Error in closeJobAndNotify:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Periodic check for expired jobs
 */
const checkExpiredJobs = async () => {
    try {
        const now = new Date();
        const expiredJobs = await Job.find({
            status: 'active',
            deadline: { $lte: now }
        });

        if (expiredJobs.length > 0) {
            console.log(`[Job Expiry Checker] Found ${expiredJobs.length} expired job(s). Closing & sending leaderboards...`);
        }

        for (const job of expiredJobs) {
            await closeJobAndNotify(job._id, 'expired');
        }
    } catch (err) {
        console.error('Error checking expired jobs:', err);
    }
};

/**
 * Initialize background cron scheduler
 * Runs every 5 minutes
 */
const initJobExpiryCron = () => {
    // Every 5 minutes
    cron.schedule('*/5 * * * *', () => {
        checkExpiredJobs();
    });
    console.log('Job Expiry Cron job initialized (runs every 5 minutes).');
    // Run an immediate check on startup
    checkExpiredJobs();
};

module.exports = {
    closeJobAndNotify,
    sendLeaderboardEmail,
    checkExpiredJobs,
    initJobExpiryCron
};
