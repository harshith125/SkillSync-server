const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
const { evaluateCandidateWithGemini } = require('../services/geminiService');
const { sendEmail } = require('../services/emailService');

// Configure Multer for PDF Resumes
const uploadDir = path.join(__dirname, '../../client/public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'resume-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const filetypes = /pdf|doc|docx/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype) ||
            file.mimetype === 'application/pdf' ||
            file.mimetype === 'application/msword' ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        if (extname || mimetype) {
            return cb(null, true);
        }
        cb(new Error('Please upload a PDF or DOCX resume.'));
    }
});

// @route   POST api/applications/apply/:jobId
// @desc    Apply for a job with PDF resume & Gemini AI evaluation
// @access  Private (Candidate only)
router.post('/apply/:jobId', auth, upload.single('resume'), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'candidate') {
            return res.status(403).json({ msg: 'Only candidates can apply to jobs' });
        }

        const job = await Job.findById(req.params.jobId);
        if (!job) {
            return res.status(404).json({ msg: 'Job not found' });
        }

        if (job.status !== 'active' || (job.deadline && new Date() > new Date(job.deadline))) {
            return res.status(400).json({ msg: 'This job posting has expired or is closed for new applications.' });
        }

        // Prevent duplicate application
        const existingApp = await Application.findOne({ candidate: req.user.id, job: req.params.jobId });
        if (existingApp) {
            return res.status(400).json({ msg: 'You have already applied to this job.' });
        }

        // Handle Resume Upload & Text Extraction
        let resumePath = user.resume || null;
        let resumeText = '';

        if (req.file) {
            resumePath = `/uploads/${req.file.filename}`;
            try {
                // If it's a PDF, extract text using pdf-parse
                if (req.file.mimetype === 'application/pdf' || req.file.filename.endsWith('.pdf')) {
                    const fileBuffer = fs.readFileSync(req.file.path);
                    const pdfData = await pdf(fileBuffer);
                    resumeText = pdfData.text || '';
                }
            } catch (parseErr) {
                console.error('Error parsing uploaded resume PDF:', parseErr.message);
            }
        }

        // Evaluate candidate fit with Gemini AI (fallback if key is unavailable)
        console.log(`Evaluating candidate "${user.fullName}" for job "${job.title}" with Gemini AI...`);
        const aiEvaluation = await evaluateCandidateWithGemini(job, user, resumeText);

        const initialStage = (job.stages && job.stages.length > 0) ? job.stages[0] : 'Applied';

        const { relevantProjects, relevantExperience } = req.body;

        const application = new Application({
            candidate: req.user.id,
            job: req.params.jobId,
            status: 'applied',
            currentStage: initialStage,
            stageHistory: [{ stage: initialStage, changedAt: new Date() }],
            aiScore: aiEvaluation.score,
            aiSummary: aiEvaluation.summary,
            aiStrengths: aiEvaluation.strengths,
            aiWeaknesses: aiEvaluation.weaknesses,
            relevantProjects: relevantProjects || '',
            relevantExperience: relevantExperience || '',
            customResume: resumePath
        });

        await application.save();

        // Send confirmation email to candidate
        try {
            await sendEmail(
                user.email,
                `Application Received: ${job.title} at ${job.companyName}`,
                `<h1>Application Successfully Submitted!</h1>
                 <p>Hello ${user.fullName},</p>
                 <p>Your application for <strong>${job.title}</strong> at <strong>${job.companyName}</strong> has been received.</p>
                 <p>Our AI screening engine has processed your profile and resume. You will be notified by email when meetings or selection stages are scheduled.</p>
                 <p>Best regards,<br/>SkillSync Team</p>`
            );
        } catch (emailErr) {
            console.error('Candidate confirmation email failed:', emailErr.message);
        }

        res.json({
            msg: 'Application submitted successfully!',
            application
        });

    } catch (err) {
        console.error('Application error:', err);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   GET api/applications/job/:jobId
// @desc    Get all applications for a specific job sorted by AI Leaderboard (Interviewer only)
// @access  Private (Interviewer only)
router.get('/job/:jobId', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'interviewer') {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const job = await Job.findById(req.params.jobId);
        if (!job) return res.status(404).json({ msg: 'Job not found' });

        if (job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to view applicants for this job' });
        }

        const applications = await Application.find({ job: req.params.jobId })
            .populate('candidate', ['fullName', 'email', 'mobile', 'skills', 'experience', 'profilePicture', 'resume', 'education', 'links'])
            .sort({ aiScore: -1, appliedAt: 1 }); // Leaderboard ranking

        res.json({
            job,
            applications
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/applications/:id/stage
// @desc    Update candidate's dynamic selection stage (Interviewer only)
// @access  Private (Interviewer only)
router.put('/:id/stage', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'interviewer') {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const { stage } = req.body;
        if (!stage) {
            return res.status(400).json({ msg: 'Stage is required' });
        }

        const application = await Application.findById(req.params.id)
            .populate('candidate', ['fullName', 'email'])
            .populate('job', ['title', 'companyName', 'stages', 'company']);

        if (!application) return res.status(404).json({ msg: 'Application not found' });

        if (application.job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized to modify this candidate' });
        }

        application.currentStage = stage;
        application.stageHistory.push({ stage, changedAt: new Date() });

        // Update general status if matched
        if (stage.toLowerCase().includes('select') || stage.toLowerCase().includes('offer')) {
            application.status = 'offer';
        } else if (stage.toLowerCase().includes('reject')) {
            application.status = 'rejected';
        } else {
            application.status = 'in-progress';
        }

        await application.save();

        // Send email alert to candidate
        try {
            await sendEmail(
                application.candidate.email,
                `Application Update: Shortlisted for ${stage} - ${application.job.title}`,
                `<div style="font-family: Arial, sans-serif; max-width: 600px; color: #1e293b;">
                    <h2>Congratulations ${application.candidate.fullName}!</h2>
                    <p>We are excited to inform you that your application for <strong>${application.job.title}</strong> at <strong>${application.job.companyName}</strong> has advanced to:</p>
                    <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 16px 0; font-size: 16px; font-weight: bold; color: #1d4ed8;">
                        🎯 ${stage}
                    </div>
                    <p>The recruitment team will reach out with interview details or meeting invitations soon.</p>
                    <p>Best regards,<br/>SkillSync Team</p>
                </div>`
            );
        } catch (mailErr) {
            console.error('Candidate stage update email failed:', mailErr.message);
        }

        res.json({
            msg: `Candidate moved to stage "${stage}"`,
            application
        });
    } catch (err) {
        console.error('Error updating stage:', err);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   PUT api/applications/:id/status
// @desc    Update application general status (Interviewer only)
// @access  Private (Interviewer only)
router.put('/:id/status', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'interviewer') {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const { status } = req.body;
        let application = await Application.findById(req.params.id)
            .populate('candidate', ['fullName', 'email'])
            .populate('job', ['title', 'companyName', 'company']);

        if (!application) return res.status(404).json({ msg: 'Application not found' });

        if (application.job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        application.status = status;
        await application.save();

        res.json(application);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/applications/my
// @desc    Get all applications for logged-in candidate
// @access  Private
router.get('/my', auth, async (req, res) => {
    try {
        const applications = await Application.find({ candidate: req.user.id })
            .populate('job', ['title', 'companyName', 'location', 'salary', 'status', 'deadline', 'stages'])
            .sort({ appliedAt: -1 });

        res.json(applications);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/applications/:id
// @desc    Get single application details
// @access  Private
router.get('/:id', auth, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate('candidate', ['fullName', 'email', 'mobile', 'skills', 'experience', 'profilePicture', 'resume', 'education', 'links', 'bio'])
            .populate('job', ['title', 'companyName', 'location', 'salary', 'status', 'deadline', 'stages', 'company', 'description', 'requirements']);

        if (!application) return res.status(404).json({ msg: 'Application not found' });

        // Must be the candidate or the job's company
        const isCandidate = application.candidate && application.candidate._id.toString() === req.user.id;
        const isRecruiter = application.job && application.job.company.toString() === req.user.id;

        if (!isCandidate && !isRecruiter) {
            return res.status(403).json({ msg: 'Not authorized to view this application' });
        }

        res.json(application);
    } catch (err) {
        if (err.kind === 'ObjectId') return res.status(404).json({ msg: 'Application not found' });
        res.status(500).send('Server Error');
    }
});

// @route   PATCH api/applications/:id/stage
// @desc    REST alias to update candidate stage
// @access  Private (Interviewer only)
router.patch('/:id/stage', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'interviewer') {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        const { stage } = req.body;
        if (!stage) return res.status(400).json({ msg: 'Stage is required' });

        const application = await Application.findById(req.params.id)
            .populate('candidate', ['fullName', 'email'])
            .populate('job', ['title', 'companyName', 'stages', 'company']);

        if (!application) return res.status(404).json({ msg: 'Application not found' });
        if (application.job.company.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        application.currentStage = stage;
        application.stageHistory.push({ stage, changedAt: new Date() });

        if (stage.toLowerCase().includes('select') || stage.toLowerCase().includes('offer')) {
            application.status = 'offer';
        } else if (stage.toLowerCase().includes('reject')) {
            application.status = 'rejected';
        } else {
            application.status = 'in-progress';
        }

        await application.save();
        res.json({ msg: `Candidate moved to stage "${stage}"`, application });
    } catch (err) {
        res.status(500).send('Server Error: ' + err.message);
    }
});

// @route   DELETE api/applications/:id
// @desc    Withdraw or delete an application
// @access  Private
router.delete('/:id', auth, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id).populate('job', ['company']);
        if (!application) return res.status(404).json({ msg: 'Application not found' });

        const isCandidate = application.candidate.toString() === req.user.id;
        const isRecruiter = application.job && application.job.company.toString() === req.user.id;

        if (!isCandidate && !isRecruiter) {
            return res.status(403).json({ msg: 'Not authorized to delete this application' });
        }

        await application.deleteOne();
        res.json({ msg: 'Application removed successfully' });
    } catch (err) {
        res.status(500).send('Server Error: ' + err.message);
    }
});

module.exports = router;
