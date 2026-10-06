const mongoose = require('mongoose');

const ApplicationSchema = new mongoose.Schema({
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    job: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    status: {
        type: String,
        enum: ['applied', 'in-progress', 'shortlisted', 'interview', 'rejected', 'offer'],
        default: 'applied'
    },
    currentStage: {
        type: String,
        default: 'Applied'
    },
    stageHistory: [{
        stage: String,
        changedAt: { type: Date, default: Date.now }
    }],
    appliedAt: {
        type: Date,
        default: Date.now
    },
    aiScore: {
        type: Number,
        default: 0
    },
    aiSummary: {
        type: String,
        default: ''
    },
    aiStrengths: [{
        type: String
    }],
    aiWeaknesses: [{
        type: String
    }],
    feedback: {
        type: String
    },
    relevantProjects: {
        type: String
    },
    relevantExperience: {
        type: String
    },
    customResume: {
        type: String
    }
});

module.exports = mongoose.model('Application', ApplicationSchema);
