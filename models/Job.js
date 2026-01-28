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
        enum: ['active', 'closed'],
        default: 'active'
    },
    deadline: {
        type: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('Job', JobSchema);
