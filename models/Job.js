const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    companyName: { // Stored for easier access
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    requirements: [{ // Skills required
        type: String
    }],
    experienceRequired: {
        type: Number,
        required: true
    },
    salary: {
        type: String
    },
    location: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'closed', 'expired'],
        default: 'active'
    },
    deadline: {
        type: Date,
        required: true
    },
    stages: {
        type: [String],
        default: ['Applied', 'Orientation / Round 1', 'Technical Interview', 'HR Round', 'Selected']
    },
    leaderboardSent: {
        type: Boolean,
        default: false
    },
    scheduledMeets: [{
        title: { type: String, required: true },
        description: { type: String, default: '' },
        meetLink: { type: String, required: true },
        date: { type: Date, required: true },
        time: { type: String, required: true },
        targetStage: { type: String, default: 'All' },
        recipientsCount: { type: Number, default: 0 },
        scheduledAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Job', JobSchema);
