const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Job = require('../models/Job');
const User = require('../models/User');
const Application = require('../models/Application');
const { matchJobToCandidates } = require('../services/matchingService');
const { closeJobAndNotify } = require('../services/jobExpiryService');
const { generateGoogleMeetLink, sendMeetingInvitations } = require('../services/meetService');

// @route   POST api/jobs
// @desc    Post a new job (Deadline mandatory, customizable stages)
// @access  Private (Interviewer only)
router.post('/', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'interviewer') {
            return res.status(403).json({ msg: 'Only interviewers can post jobs' });
        }

        const { title, description, requirements, experienceRequired, salary, location, deadline, stages } = req.body;

        if (!deadline) {
            return res.status(400).json({ msg: 'Application deadline is mandatory.' });
        }

        // Parse requirements array
        let reqList = [];
        if (Array.isArray(requirements)) {
            reqList = requirements;
        } else if (typeof requirements === 'string') {
            reqList = requirements.split(',').map(s => s.trim()).filter(Boolean);
        }

        // Parse custom stages if provided
        let jobStages = ['Applied', 'Orientation / Round 1', 'Technical Assessment', 'HR Interview', 'Selected'];
        if (Array.isArray(stages) && stages.length > 0) {
            jobStages = stages.map(s => typeof s === 'string' ? s.trim() : s).filter(Boolean);
        } else if (typeof stages === 'string' && stages.trim()) {
            jobStages = stages.split(',').map(s => s.trim()).filter(Boolean);
        }

        const newJob = new Job({
            company: req.user.id,
            companyName: user.companyName,
            title,
            description,
            requirements: reqList,
            experienceRequired: Number(experienceRequired) || 0,
            salary,
            location,
            deadline: new Date(deadline),
            stages: jobStages
        });

        const job = await newJob.save();

        // Trigger Matching Service in background
        try {
            if (typeof matchJobToCandidates === 'function') {
                matchJobToCandidates(job);
            }
        } catch (matchErr) {
            console.error('Matching service trigger error:', matchErr.message);
        }

        res.json(job);
    } catch (err) {
        console.error('Error posting job:', err.message);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   GET api/jobs/my-jobs
// @desc    Get jobs posted by current company with applicant counts
// @access  Private (Interviewer only)
router.get('/my-jobs', auth, async (req, res) => {
    try {
        const jobs = await Job.find({ company: req.user.id }).sort({ createdAt: -1 });

        // Augment each job with application count and stage breakdown
        const jobsWithStats = await Promise.all(jobs.map(async (job) => {
            const totalApplicants = await Application.countDocuments({ job: job._id });
            const jobObj = job.toObject();
            jobObj.totalApplicants = totalApplicants;
            return jobObj;
        }));

        res.json(jobsWithStats);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/jobs
// @desc    Get active jobs (for Candidates)
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const now = new Date();
        // Return jobs that are active and not past deadline
        const jobs = await Job.find({
            status: 'active',
            deadline: { $gte: now }
        }).sort({ createdAt: -1 });

        res.json(jobs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/jobs/:id/close
// @desc    Manually close a job opening & trigger candidate leaderboard email
// @access  Private (Interviewer only)
router.put('/:id/close', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to close this job' });
        }

        if (job.status === 'closed') {
            return res.status(400).json({ msg: 'Job is already closed' });
        }

        const result = await closeJobAndNotify(job._id, 'manual');
        const updatedJob = await Job.findById(job._id);

        res.json({
            msg: `Job successfully closed! Candidate leaderboard with ${result.count || 0} applicants has been emailed to you.`,
            job: updatedJob
        });
    } catch (err) {
        console.error('Error closing job:', err);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   GET api/jobs/:id/generate-meet-link
// @desc    Generate a fresh standard Google Meet link
// @access  Private (Interviewer only)
router.get('/:id/generate-meet-link', auth, async (req, res) => {
    try {
        const meetLink = generateGoogleMeetLink();
        res.json({ meetLink });
    } catch (err) {
        res.status(500).send('Error generating meet link');
    }
});

// @route   POST api/jobs/:id/schedule-meeting
// @desc    Schedule a Google Meet session with applicants (All or per Stage)
// @access  Private (Interviewer only)
router.post('/:id/schedule-meeting', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const { title, description, meetLink, date, time, stage } = req.body;

        if (!title || !date || !time) {
            return res.status(400).json({ msg: 'Meeting title, date, and time are required' });
        }

        const user = await User.findById(req.user.id);
        let actualMeetLink = meetLink && meetLink.trim() ? meetLink.trim() : null;
        let googleEventDetails = null;

        // Query applications matching the target stage
        let query = { job: job._id };
        if (stage && stage !== 'All') {
            query.currentStage = stage;
        }

        const applications = await Application.find(query).populate('candidate', ['fullName', 'email']);
        const candidates = applications.map(app => app.candidate).filter(c => c && c.email);

        if (candidates.length === 0) {
            return res.status(400).json({ msg: `No candidates found in ${stage === 'All' ? 'the applicant list' : `stage "${stage}"`}` });
        }

        // If user is connected to Google Calendar, automatically create a real Google Calendar event + Google Meet
        if (user && user.isGoogleConnected && user.googleTokens && !actualMeetLink) {
            try {
                const { createCalendarInterviewEvent } = require('../services/googleService');
                const candidateEmails = candidates.map(c => c.email);
                
                // Parse date & time into ISO start/end
                const [timePart, modifier] = (time || '10:00 AM').split(' ');
                let [hours, minutes] = (timePart || '10:00').split(':').map(Number);
                if (modifier && modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
                if (modifier && modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

                const startDateTime = new Date(date);
                startDateTime.setHours(hours || 10, minutes || 0, 0, 0);

                googleEventDetails = await createCalendarInterviewEvent({
                    user,
                    title: `${title} - ${job.companyName}`,
                    description: `${description || ''}\n\nJob: ${job.title}\nStage: ${stage || 'All Applicants'}`,
                    startTime: startDateTime,
                    attendees: candidateEmails
                });

                if (googleEventDetails && googleEventDetails.meetLink) {
                    actualMeetLink = googleEventDetails.meetLink;
                }
            } catch (calErr) {
                console.warn('[Google Calendar Event Auto-Create Failed]: Falling back to standard link generator:', calErr.message);
            }
        }

        if (!actualMeetLink) {
            actualMeetLink = generateGoogleMeetLink();
        }

        // Send Email Invitations
        const inviteResult = await sendMeetingInvitations({
            job,
            title,
            description,
            meetLink: actualMeetLink,
            date,
            time,
            stage,
            candidates
        });

        // Record scheduled meet in job
        job.scheduledMeets.push({
            title,
            description,
            meetLink: actualMeetLink,
            date: new Date(date),
            time,
            targetStage: stage || 'All',
            recipientsCount: inviteResult.count
        });
        await job.save();

        res.json({
            msg: `Meeting scheduled! Google Meet invitations dispatched to ${inviteResult.count} candidate(s).`,
            meetLink: actualMeetLink,
            invitedCount: inviteResult.count
        });
    } catch (err) {
        console.error('Error scheduling meeting:', err);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   PUT api/jobs/:id/stages
// @desc    Update hiring stages for a job
// @access  Private (Interviewer only)
router.put('/:id/stages', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const { stages } = req.body;
        if (!Array.isArray(stages) || stages.length === 0) {
            return res.status(400).json({ msg: 'Stages must be a non-empty array' });
        }

        job.stages = stages.map(s => s.trim()).filter(Boolean);
        await job.save();

        res.json(job);
    } catch (err) {
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   GET api/jobs/:id
// @desc    Get single job details
// @access  Private
router.get('/:id', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id).populate('company', ['companyName', 'email', 'avatar']);
        if (!job) return res.status(404).json({ msg: 'Job not found' });
        res.json(job);
    } catch (err) {
        if (err.kind === 'ObjectId') return res.status(404).json({ msg: 'Job not found' });
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/jobs/:id
// @desc    Update a job posting
// @access  Private (Interviewer only)
router.put('/:id', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to update this job' });
        }

        const { title, description, requirements, experienceRequired, salary, location, deadline, stages } = req.body;
        if (title) job.title = title;
        if (description) job.description = description;
        if (salary !== undefined) job.salary = salary;
        if (location !== undefined) job.location = location;
        if (experienceRequired !== undefined) job.experienceRequired = Number(experienceRequired);
        if (deadline) job.deadline = new Date(deadline);
        if (requirements) {
            job.requirements = Array.isArray(requirements)
                ? requirements
                : requirements.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (stages && Array.isArray(stages) && stages.length > 0) {
            job.stages = stages.map(s => s.trim()).filter(Boolean);
        }

        await job.save();
        res.json(job);
    } catch (err) {
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   PATCH api/jobs/:id/status
// @desc    Toggle job status (active / closed)
// @access  Private (Interviewer only)
router.patch('/:id/status', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const { status } = req.body;
        if (!['active', 'closed'].includes(status)) {
            return res.status(400).json({ msg: 'Status must be active or closed' });
        }

        job.status = status;
        await job.save();
        res.json(job);
    } catch (err) {
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   DELETE api/jobs/:id
// @desc    Delete a job posting and its applications
// @access  Private (Interviewer only)
router.delete('/:id', auth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to delete this job' });
        }

        await Application.deleteMany({ job: job._id });
        await job.deleteOne();

        res.json({ msg: 'Job and associated applications deleted successfully' });
    } catch (err) {
        res.status(500).send('Server Error: ' + err.message);
    }
});

module.exports = router;
