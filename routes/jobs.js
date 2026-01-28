const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Job = require('../models/Job');
const User = require('../models/User');
const { matchJobToCandidates } = require('../services/matchingService');

// @route   POST api/jobs
// @desc    Post a new job
// @access  Private (Interviewer only)
router.post('/', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'interviewer') {
            return res.status(403).json({ msg: 'Only interviewers can post jobs' });
        }

        const { title, description, requirements, experienceRequired, salary, location, deadline } = req.body;

        const newJob = new Job({
            company: req.user.id,
            companyName: user.companyName,
            title,
            description,
            requirements: requirements.split(',').map(s => s.trim()),
            experienceRequired,
            salary,
            location,
            deadline
        });

        const job = await newJob.save();

        // Trigger Matching Service
        // We don't await this so the response is fast
        matchJobToCandidates(job);

        res.json(job);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/jobs/my-jobs
// @desc    Get jobs posted by current company
// @access  Private
router.get('/my-jobs', auth, async (req, res) => {
    try {
        const jobs = await Job.find({ company: req.user.id }).sort({ createdAt: -1 });
        res.json(jobs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/jobs
// @desc    Get all jobs (for Candidates)
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        // In a real app, pagination and filters would go here
        const jobs = await Job.find({ status: 'active' }).sort({ createdAt: -1 });
        res.json(jobs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/jobs/:id/apply
// @desc    Apply for a job (Candidate only)
// @access  Private
router.post('/:id/apply', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'candidate') {
            return res.status(403).json({ msg: 'Only candidates can apply to jobs' });
        }

        const job = await Job.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ msg: 'Job not found' });
        }

        // Logic check: prevent double application could go here, 
        // but for now we just send the email.

        // Send Email to Company
        const { sendEmail } = require('../services/emailService');
        const companyUser = await User.findById(job.company);

        if (companyUser) {
            await sendEmail(
                companyUser.email,
                `New Application for ${job.title}`,
                `<h1>New Candidate Application</h1>
                 <p><strong>${user.fullName}</strong> has applied for <strong>${job.title}</strong>.</p>
                 <p><strong>Experience:</strong> ${user.experience ? user.experience.years : 0} years</p>
                 <p><strong>Skills:</strong> ${user.skills.join(', ')}</p>
                 <p><strong>Email:</strong> ${user.email}</p>
                 <p><a href="${user.resume}">View Resume</a></p>`
            );
        }

        // Optional: Send confirmation to Candidate
        await sendEmail(
            user.email,
            `Application Confirmation: ${job.title}`,
            `<h1>Application Sent!</h1>
             <p>You have successfully applied for <strong>${job.title}</strong> at ${job.companyName}.</p>
             <p>Good luck!</p>`
        );

        res.json({ msg: 'Application sent successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
