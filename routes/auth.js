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
        res.status(500).send('Server error');
    }
});

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
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
        res.status(500).send('Server error');
    }
});

// @route   GET api/auth/me
// @desc    Get current user (protected)
// @access  Private
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -googleTokens');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
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
        const nowOpen = updateData.isOpenToWork;

        // Update fields
        user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true }
        ).select('-password');

        // Trigger matching if candidate toggled 'open to work' to true
        if (user.role === 'candidate' && !wasOpen && nowOpen === "true" || user.role === 'candidate' && !wasOpen && nowOpen === true) {
            const { matchCandidateToJobs } = require('../services/matchingService');
            matchCandidateToJobs(user);
        }

        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/auth/forgot-password
// @desc    Send password reset email with token link
// @access  Public
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ msg: 'Please provide a valid email address.' });
    }

    try {
        const crypto = require('crypto');
        const { sendPasswordResetEmail } = require('../services/emailService');

        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) {
            return res.status(404).json({ msg: 'No registered account found with this email address.' });
        }

        // Generate 32-byte secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex');

        // Set reset token and expiration (60 minutes from now)
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = new Date(Date.now() + 3600000);
        await user.save();

        const clientBaseUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        const resetUrl = `${clientBaseUrl}/reset-password/${resetToken}`;

        // Send reset email via Nodemailer
        let emailSent = false;
        try {
            emailSent = await sendPasswordResetEmail(user.email, resetUrl);
        } catch (mailErr) {
            console.warn('⚠️ Nodemailer delivery error:', mailErr.message);
            emailSent = false;
        }

        console.log(`\n======================================================`);
        console.log(`🔑 PASSWORD RESET LINK GENERATED FOR: ${user.email}`);
        console.log(`🔗 RESET URL: ${resetUrl}`);
        console.log(`📧 Email Delivered to SMTP: ${emailSent ? 'YES' : 'NO (Check Gmail App Password in .env)'}`);
        console.log(`======================================================\n`);

        res.json({
            success: true,
            emailSent,
            resetUrl,
            msg: emailSent
                ? `A password reset link has been dispatched to ${user.email}. Please check your inbox (and spam folder).`
                : `Password reset link created! (SMTP error: Gmail rejected credentials). Use the link below to reset your password directly.`
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ msg: 'Server error processing password reset request.' });
    }
});

// @route   GET api/auth/verify-reset-token/:token
// @desc    Verify if a password reset token is valid and unexpired
// @access  Public
router.get('/verify-reset-token/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                valid: false,
                msg: 'Password reset link is invalid or has expired. Please request a new one.'
            });
        }

        res.json({ valid: true, email: user.email });
    } catch (err) {
        console.error('Verify reset token error:', err);
        res.status(500).json({ valid: false, msg: 'Server error validating token.' });
    }
});

// @route   POST api/auth/reset-password/:token
// @desc    Set new password using valid reset token
// @access  Public
router.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
        return res.status(400).json({ msg: 'Password must be at least 6 characters long.' });
    }

    try {
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                msg: 'Password reset token is invalid or has expired. Please request a new link.'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        // Invalidate token
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        res.json({
            success: true,
            msg: 'Your password has been successfully reset! You can now log in with your new password.'
        });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ msg: 'Server error updating password.' });
    }
});

module.exports = router;
