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
    appliedAt: {
        type: Date,
        default: Date.now
    },
    aiScore: {
        type: Number,
        default: 0
    },
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
