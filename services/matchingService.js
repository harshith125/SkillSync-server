const User = require('../models/User');
const { sendEmail } = require('./emailService');

// Called when a new job is posted
const matchJobToCandidates = async (job) => {
    try {
        // Find candidates who are open to work
        // Filter logic:
        // 1. Candidate Experience >= Job Required Experience
        // 2. Candidate Skills overlap with Job Requirements

        // We'll fetch all candidate users first for simplicity (optimize with detailed queries in production)
        const candidates = await User.find({
            role: 'candidate',
            isOpenToWork: true,
            'experience.years': { $gte: job.experienceRequired }
        });

        const jobSkills = job.requirements.map(s => s.toLowerCase());

        const matches = candidates.filter(candidate => {
            const candidateSkills = candidate.skills.map(s => s.toLowerCase());
            // Check for skill intersection
            const hasSkillMatch = jobSkills.some(skill => candidateSkills.includes(skill));
            return hasSkillMatch;
        });

        console.log(`Found ${matches.length} matches for job ${job.title}`);

        // Send Emails
        for (const candidate of matches) {
            // Email to Candidate
            await sendEmail(
                candidate.email,
                `New Job Match: ${job.title} at ${job.companyName}`,
                `<h1>It's a Match!</h1>
         <p>Hello ${candidate.fullName},</p>
         <p>Your skills sync with a new job posting!</p>
         <h3>${job.title}</h3>
         <p><strong>Company:</strong> ${job.companyName}</p>
         <p><strong>Location:</strong> ${job.location}</p>
         <p><strong>Salary:</strong> ${job.salary}</p>
         <p>Apply now on SkillSync.</p>`
            );

            // Email to Company (Notification about this candidate)
            // Note: This might spam the company if many matches. 
            // Requirement: "notification... to the compnay that there is a person exist with syncing with your requried skills"
            // I will send one email per candidate found.
            const companyUser = await User.findById(job.company);
            if (companyUser) {
                await sendEmail(
                    companyUser.email,
                    `Candidate Match Found for ${job.title}`,
                    `<h1>Candidate Match!</h1>
             <p>Hello ${job.companyName},</p>
             <p>We found a candidate whose skills match your job posting <strong>${job.title}</strong>.</p>
             <p><strong>Name:</strong> ${candidate.fullName}</p>
             <p><strong>Experience:</strong> ${candidate.experience ? candidate.experience.years : 0} years</p>
             <p><strong>Skills:</strong> ${candidate.skills.join(', ')}</p>
             <p><strong>Resume:</strong> <a href="${candidate.resume}">View Resume</a></p>`
                );
            }
        }

    } catch (err) {
        console.error('Matching Service Error:', err);
    }
};

const Job = require('../models/Job'); // Ensure Job model is imported

// ... existing code ...

// Called when a new candidate registers or updates profile
const matchCandidateToJobs = async (candidate) => {
    try {
        if (candidate.role !== 'candidate') return;

        // Find active jobs that match this candidate
        // Logic: Job Experience <= Candidate Experience && Job Requirements overlap with Candidate Skills
        const jobs = await Job.find({
            status: 'active',
            experienceRequired: { $lte: candidate.experience ? candidate.experience.years : 0 }
        });

        const candidateSkills = candidate.skills.map(s => s.toLowerCase());

        const matches = jobs.filter(job => {
            const jobSkills = job.requirements.map(s => s.toLowerCase());
            const hasSkillMatch = jobSkills.some(skill => candidateSkills.includes(skill));
            return hasSkillMatch;
        });

        console.log(`Found ${matches.length} job matches for candidate ${candidate.fullName}`);

        for (const job of matches) {
            // Email to Candidate
            await sendEmail(
                candidate.email,
                `New Job Match: ${job.title} at ${job.companyName}`,
                `<h1>It's a Match!</h1>
         <p>Hello ${candidate.fullName},</p>
         <p>Your skills sync with a new job posting!</p>
         <h3>${job.title}</h3>
         <p><strong>Company:</strong> ${job.companyName}</p>
         <p><strong>Location:</strong> ${job.location}</p>
         <p><strong>Salary:</strong> ${job.salary}</p>
         <p>Apply now on SkillSync.</p>`
            );

            // Email to Company
            const companyUser = await User.findById(job.company);
            if (companyUser) {
                await sendEmail(
                    companyUser.email,
                    `Candidate Match Found for ${job.title}`,
                    `<h1>Candidate Match!</h1>
             <p>Hello ${job.companyName},</p>
             <p>We found a candidate whose skills match your job posting <strong>${job.title}</strong>.</p>
             <p><strong>Name:</strong> ${candidate.fullName}</p>
             <p><strong>Experience:</strong> ${candidate.experience ? candidate.experience.years : 0} years</p>
             <p><strong>Skills:</strong> ${candidate.skills.join(', ')}</p>
             <p><strong>Resume:</strong> <a href="${candidate.resume}">View Resume</a></p>`
                );
            }
        }

    } catch (err) {
        console.error('Matching Service (Reverse) Error:', err);
    }
};

module.exports = { matchJobToCandidates, matchCandidateToJobs };
