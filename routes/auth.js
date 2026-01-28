const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const User = require('../models/User');

// @route   POST api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', async (req, res) => {
    const { email, password, role, ...otherDetails } = req.body;

    try {
        let user = await User.findOne({ email });

        if (user) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        user = new User({
            email,
            password,
            role,
            ...otherDetails
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();

        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET || 'secretKey',
            { expiresIn: 360000 },
            (err, token) => {
                if (err) throw err;

                // Trigger matching service for new candidate
                const { matchCandidateToJobs } = require('../services/matchingService');
                matchCandidateToJobs(user);

                res.json({ token });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error: ' + err.message });
    }
});

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ msg: 'Please provide both email and password' });
        }

        let user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET || 'secretKey',
            { expiresIn: 360000 },
            (err, token) => {
                if (err) throw err;
                res.json({ token });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error: ' + err.message });
    }
});

// @route   GET api/auth/me
// @desc    Get current user (protected)
// @access  Private
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Multer for Profile Picture
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
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
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname))
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Error: File upload only supports: jpeg, jpg, png, webp"));
    }
});

// @route   POST api/auth/profile-picture
// @desc    Upload profile picture
// @access  Private
router.post('/profile-picture', auth, (req, res) => {
    upload.single('profilePicture')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            // A Multer error occurred when uploading.
            return res.status(400).json({ msg: `Upload Error: ${err.message}` });
        } else if (err) {
            // An unknown error occurred when uploading.
            return res.status(400).json({ msg: err.message });
        }

        // Everything went fine.
        try {
            if (!req.file) {
                return res.status(400).json({ msg: 'No file uploaded' });
            }

            const imageUrl = `/uploads/${req.file.filename}`;

            let user = await User.findById(req.user.id);
            if (!user) return res.status(404).json({ msg: 'User not found' });

            user.profilePicture = imageUrl;
            await user.save();

            res.json({ profilePicture: imageUrl });
        } catch (serverErr) {
            console.error(serverErr);
            res.status(500).json({ msg: 'Server Error: ' + serverErr.message });
        }
    });
});


// @route   PUT api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, async (req, res) => {
    try {
        const { email, password, role, ...updateData } = req.body;

        // Prevent updating sensitive fields directly here if needed (e.g., role)
        // For now, we trust the destructuring above to only allow other fields

        let user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        // Check if isOpenToWork is being toggled ON
        const wasOpen = user.isOpenToWork;

        // Ensure isOpenToWork is correctly parsed as boolean
        if (updateData.isOpenToWork !== undefined) {
            updateData.isOpenToWork = updateData.isOpenToWork === true || updateData.isOpenToWork === 'true';
        }

        const nowOpen = updateData.isOpenToWork;

        // Update fields
        user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true }
        ).select('-password');

        // Trigger matching if candidate toggled 'open to work' to true
        // AND ONLY IF IT WAS NOT OPEN BEFORE. This prevents spamming on every update.
        if (user.role === 'candidate' && !wasOpen && nowOpen) {
            // Lazy load to avoid circular dependency issues if any
            try {
                const { matchCandidateToJobs } = require('../services/matchingService');
                if (matchCandidateToJobs) matchCandidateToJobs(user);
            } catch (e) {
                console.warn("Matching service not ready", e.message);
            }
        }

        res.json(user);
    } catch (err) {
        console.error(err.message, err); // Log the full error
        // If it's a validation error, return the specific message
        if (err.name === 'ValidationError') {
            return res.status(400).json({ msg: err.message });
        }
        res.status(500).json({ msg: 'Server Error: ' + err.message });
    }
});

module.exports = router;
