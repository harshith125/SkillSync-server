const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

const PLANS = {
    '1_month': { name: '1 Month PRO', price: 299, days: 30 },
    '3_months': { name: '3 Months PRO', price: 799, days: 90 },
    '6_months': { name: '6 Months PRO', price: 1399, days: 180 }
};

// @route   GET api/subscription/status
// @desc    Get current user's PRO subscription status & available plans
// @access  Private
router.get('/status', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('isPro proPlan proExpiresAt paymentHistory role');
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Check if subscription has expired
        let isPro = user.isPro || false;
        if (isPro && user.proExpiresAt && new Date() > new Date(user.proExpiresAt)) {
            isPro = false;
            user.isPro = false;
            await user.save();
        }

        res.json({
            isPro,
            proPlan: user.proPlan,
            proExpiresAt: user.proExpiresAt,
            paymentHistory: user.paymentHistory || [],
            plans: PLANS
        });
    } catch (err) {
        console.error('Subscription status error:', err);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/subscription/activate
// @desc    Activate PRO subscription immediately via UPI/QR code payment & UTR submission
// @access  Private
router.post('/activate', auth, async (req, res) => {
    try {
        const { plan, utrNumber } = req.body;

        if (!PLANS[plan]) {
            return res.status(400).json({ msg: 'Invalid plan selected. Choose 1 Month, 3 Months, or 6 Months.' });
        }

        if (!utrNumber || utrNumber.trim().length < 6) {
            return res.status(400).json({ msg: 'Please enter a valid 12-digit UPI / UTR Transaction Reference Number.' });
        }

        const selectedPlan = PLANS[plan];
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Calculate expiration date
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + selectedPlan.days);

        // Immediate activation as requested
        user.isPro = true;
        user.proPlan = plan;
        user.proExpiresAt = expiresAt;

        if (!user.paymentHistory) user.paymentHistory = [];
        user.paymentHistory.push({
            plan,
            amount: selectedPlan.price,
            utrNumber: utrNumber.trim(),
            status: 'approved',
            paidAt: new Date()
        });

        await user.save();

        res.json({
            msg: `🎉 Congratulations! SkillSync PRO has been activated for ${selectedPlan.name}. Google Calendar & Meet integration is now unlocked!`,
            isPro: true,
            proPlan: plan,
            proExpiresAt: expiresAt
        });
    } catch (err) {
        console.error('Subscription activation error:', err);
        res.status(500).send('Server Error: ' + err.message);
    }
});

module.exports = router;
