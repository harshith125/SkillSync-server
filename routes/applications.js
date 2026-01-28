const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer for Resumes
const uploadDir = path.join(__dirname, '../../client/public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, 'resume-' + uniqueSuffix + path.extname(file.originalname))
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /pdf|doc|docx/;
        // Check extension
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        // Check mimetype (approximate)
        const mimetype = filetypes.test(file.mimetype) ||
            file.mimetype === 'application/pdf' ||
            file.mimetype === 'application/msword' ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        if (extname || mimetype) {
            return cb(null, true);
        }
        cb(new Error("Error: Resume upload only supports: pdf, doc, docx"));
    }
});

// @route   POST api/applications/apply/:jobId
// @desc    Apply for a job
// @access  Private (Candidate only)
router.post('/apply/:jobId', auth, upload.single('resume'), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'candidate') {
            return res.status(401).json({ msg: 'Only candidates can apply to jobs' });
        }

        const job = await Job.findById(req.params.jobId);
        if (!job) {
            return res.status(404).json({ msg: 'Job not found' });
        }

        // Check if already applied
        const existingApp = await Application.findOne({ candidate: req.user.id, job: req.params.jobId });
        if (existingApp) {
            return res.status(400).json({ msg: 'You have already applied to this job' });
        }

        // Calculate a mock "AI Score" based on skill overlap
        const candidateSkills = user.skills || [];
        const jobSkills = job.requirements || [];

        let matchCount = 0;
        jobSkills.forEach(skill => {
            if (candidateSkills.some(cs => cs.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs.toLowerCase()))) {
                matchCount++;
            }
        });

        let score = jobSkills.length > 0 ? Math.round((matchCount / jobSkills.length) * 100) : 80;

        // Custom fields from form
        const { relevantProjects, relevantExperience } = req.body;
        let customResume = null;

        if (req.file) {
            customResume = `/uploads/${req.file.filename}`;
        }

        // create application
        const application = new Application({
            candidate: req.user.id,
            job: req.params.jobId,
            status: 'applied',
            aiScore: score,
            relevantProjects,
            relevantExperience,
            customResume
        });

        await application.save();
        res.json(application);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   GET api/applications/my
// @desc    Get all applications for current user
// @access  Private
router.get('/my', auth, async (req, res) => {
    try {
        const applications = await Application.find({ candidate: req.user.id })
            .populate('job', ['title', 'company', 'location', 'type', 'salary'])
            .sort({ appliedAt: -1 });

        res.json(applications);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/applications/job/:jobId
// @desc    Get all applications for a specific job (Interviewer only)
// @access  Private
router.get('/job/:jobId', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'interviewer') {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        // Verify job belongs to this company
        const job = await Job.findById(req.params.jobId);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to view this job applications' });
        }

        const applications = await Application.find({ job: req.params.jobId })
            .populate('candidate', ['fullName', 'email', 'skills', 'experience', 'profilePicture', 'resume'])
            .sort({ aiScore: -1 }); // Sort by best match

        res.json(applications);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/applications/:id/status
// @desc    Update application status (Interviewer only)
// @access  Private
router.put('/:id/status', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'interviewer') {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        const { status } = req.body;
        let application = await Application.findById(req.params.id)
            .populate('candidate', ['fullName', 'email'])
            .populate('job', ['title', 'companyName']);

        if (!application) return res.status(404).json({ msg: 'Application not found' });

        application.status = status;
        await application.save();

        // If shortlisted, send email
        if (status === 'shortlisted') {
            const { sendEmail } = require('../services/emailService');
            await sendEmail(
                application.candidate.email,
                `Great News! You've been shortlisted for ${application.job.title}`,
                `<h1>Congratulations ${application.candidate.fullName}!</h1>
                 <p>We are pleased to inform you that you have been <strong>shortlisted</strong> for the <strong>${application.job.title}</strong> position at <strong>${application.job.companyName}</strong>.</p>
                 <p>The company will contact you soon for the next steps.</p>
                 <p>Best regards,<br/>SkillSync Team</p>`
            );
        }

        res.json(application);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
