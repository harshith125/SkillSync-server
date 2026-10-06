const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const auth = require('../middleware/auth');

// Setup multer for memory storage (we process in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper: Keyword matching
const checkKeywords = (text, jd) => {
    if (!jd) return { score: 10, matched: [], missing: [] }; // Default low score if no JD

    // Normalize text
    const cleanText = text.toLowerCase();
    const cleanJD = jd.toLowerCase();

    // Extract keywords from JD (Simple approach: words > 4 chars, ignoring common stops)
    // In production, use NLP (Natural) or a library
    const stopWords = ['this', 'that', 'with', 'from', 'have', 'will', 'your', 'their', 'only', 'also', 'experience', 'knowledge', 'skills', 'ability', 'work', 'year', 'years'];
    const jdWords = cleanJD.match(/\b[a-z]{4,}\b/g) || [];
    const uniqueKeywords = [...new Set(jdWords.filter(w => !stopWords.includes(w)))];

    let matches = 0;
    const matchedWords = [];
    const missingWords = [];

    uniqueKeywords.forEach(word => {
        if (cleanText.includes(word)) {
            matches++;
            matchedWords.push(word);
        } else {
            missingWords.push(word);
        }
    });

    const percentage = uniqueKeywords.length > 0 ? (matches / uniqueKeywords.length) * 100 : 100;
    return {
        score: Math.min(percentage, 100), // Raw percentage
        matched: matchedWords.slice(0, 10), // Top 10
        missing: missingWords.slice(0, 5) // Top 5 suggestions
    };
};

// Helper: Check Sections
const checkSections = (text) => {
    const required = ['summary', 'experience', 'education', 'skills', 'projects'];
    const found = [];
    const missing = [];
    const lowerText = text.toLowerCase();

    required.forEach(sec => {
        if (lowerText.includes(sec)) found.push(sec);
        else missing.push(sec);
    });

    const score = (found.length / required.length) * 100;
    return { score, found, missing };
};

// @route   POST api/ats/analyze
// @desc    Analyze extracted text from resume
// @access  Private
router.post('/analyze', auth, upload.single('resume'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ msg: 'No resume file uploaded' });
        }

        const { jobDescription } = req.body;
        let resumeText = '';

        // Parse File
        if (req.file.mimetype === 'application/pdf') {
            const data = await pdf(req.file.buffer);
            resumeText = data.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer: req.file.buffer });
            resumeText = result.value;
        } else {
            return res.status(400).json({ msg: 'Invalid file format. Upload PDF or DOCX.' });
        }

        // --- SCORING LOGIC ---
        let totalScore = 0;
        let improvements = [];

        // 1. Keywords (Weight: 35%)
        const keywordData = checkKeywords(resumeText, jobDescription);
        const keywordScore = keywordData.score;
        totalScore += keywordScore * 0.35;

        if (keywordScore < 50) {
            improvements.push({
                type: 'critical',
                text: 'Keyword matches are low. Add these form the JD: ' + keywordData.missing.slice(0, 3).join(', ')
            });
        }

        // 2. Sections (Weight: 20%)
        const sectionData = checkSections(resumeText);
        totalScore += sectionData.score * 0.20;

        if (sectionData.missing.length > 0) {
            improvements.push({
                type: 'major',
                text: `Missing standard sections: ${sectionData.missing.join(', ')}. ATS might fail to parse your data.`
            });
        }

        // 3. File Format (Weight: 10%)
        // We already know it's PDF or DOCX because we parsed it.
        totalScore += 10; // Automatic points for valid format

        // 4. Skills Section Optimization (Weight: 15%)
        // Check for "Skills" header and comma separated list near it
        const skillsRegex = /skills?[\s\S]{0,200}(,|•|\n)/i;
        if (skillsRegex.test(resumeText)) {
            totalScore += 15;
        } else {
            improvements.push({
                type: 'minor',
                text: 'Could not clearly find a "Skills" section with a list. Use bullet points or commas.'
            });
        }

        // 5. Contact Info Check (Weight: 10%)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        // Simple scan for @ symbol for email
        if (resumeText.includes('@')) {
            totalScore += 10;
        } else {
            improvements.push({
                type: 'critical',
                text: 'We could not find an email address. Ensure it is not in a header/footer image.'
            });
        }

        // 6. Formatting & Length (Weight: 10%)
        // Check length
        const wordCount = resumeText.split(/\s+/).length;
        if (wordCount > 300 && wordCount < 1500) {
            totalScore += 10;
        } else if (wordCount < 300) {
            totalScore += 5;
            improvements.push({ type: 'minor', text: 'Resume is very short. Elaborate on your experience.' });
        } else {
            totalScore += 5;
            improvements.push({ type: 'minor', text: 'Resume might be too long (> 2 pages). Keep it concise.' });
        }

        // Cap score at 100
        const finalScore = Math.min(Math.round(totalScore), 100);

        // Generate AI Summary
        let summary = "Good effort!";
        if (finalScore > 85) summary = "Excellent! Your resume is highly optimized for ATS.";
        else if (finalScore > 70) summary = "Good, but needs keyword optimization for this specific role.";
        else summary = "Needs significant improvements to pass screening.";

        res.json({
            score: finalScore,
            summary,
            improvements,
            details: {
                keywordsMatched: keywordData.matched,
                sectionsFound: sectionData.found
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error during analysis');
    }
});

module.exports = router;
