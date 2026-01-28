const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
    },
    mobile: {
        type: String,
        default: ''
    },
    password: {
        type: String,
        required: true,
    },
    role: {
        type: String,
        enum: ['candidate', 'interviewer'],
        required: true,
    },
    // Candidate Specific Fields
    fullName: {
        type: String,
        required: function () { return this.role === 'candidate'; }
    },
    college: {
        type: String,
    },
    // New Education Fields
    education: {
        tenth: {
            school: String,
            score: String,
            year: String,
            certificate: String // URL
        },
        twelfth: {
            college: String,
            score: String,
            year: String,
            certificate: String, // URL
            course: String
        },
        degree: {
            name: String, // e.g. B.Tech, BSc
            college: String,
            score: String,
            year: String,
            certificate: String, // URL
            status: { type: String, enum: ['Completed', 'Pursuing'] }
        }
    },
    experience: {
        years: { type: Number, default: 0 },
        description: String
    },
    skills: [{
        type: String
    }],
    resume: {
        type: String, // URL to file
    },
    profilePicture: {
        type: String, // URL to image
    },
    links: {
        linkedin: String,
        github: String,
        portfolio: String
    },
    isOpenToWork: {
        type: Boolean,
        default: true
    },

    // Interviewer/Company Specific Fields
    companyName: {
        type: String,
        required: function () { return this.role === 'interviewer'; }
    },
    location: {
        type: String,
    },
    aboutCompany: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
