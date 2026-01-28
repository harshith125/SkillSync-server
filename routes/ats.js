const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse'); // Downgraded to 1.1.1 to fix "is not a function" error
const mammoth = require('mammoth');
const fs = require('fs');
const auth = require('../middleware/auth');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();

// Gemini AI Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Setup multer for memory storage (we process in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper: Keyword matching with NLP
const checkKeywords = (text, jd) => {
    // If no JD, we extract key terms from the resume itself to judge "General Quality"
    const words = tokenizer.tokenize(text.toLowerCase());
    const commonWords = ['the', 'and', 'with', 'for', 'from', 'that', 'this', 'have', 'been', 'was', 'were'];

    if (!jd) {
        const uniqueWords = [...new Set(words.filter(w => w.length > 5 && !commonWords.includes(w)))];
        // Score based on vocabulary size and complexity (Mocking a general ATS)
        return {
            score: Math.min(uniqueWords.length / 1.5, 85), // Max 85 for general resumes
            matched: uniqueWords.slice(0, 5),
            missing: ["Add Job Description for targeting"]
        };
    }

    const jdWords = tokenizer.tokenize(jd.toLowerCase());
    const uniqueJD = [...new Set(jdWords.filter(w => w.length > 4 && !commonWords.includes(w)))];

    let matches = 0;
    const matchedWords = [];
    const missingWords = [];

    uniqueJD.forEach(word => {
        if (text.toLowerCase().includes(word)) {
            matches++;
            matchedWords.push(word);
        } else {
            missingWords.push(word);
        }
    });

    const percentage = uniqueJD.length > 0 ? (matches / uniqueJD.length) * 100 : 100;
    return {
        score: Math.min(percentage, 100),
        matched: matchedWords.slice(0, 10),
        missing: missingWords.slice(0, 5)
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
        // Parse File
        console.log(`Processing file: ${req.file.originalname}, Size: ${req.file.size}, Type: ${req.file.mimetype}`);

        if (req.file.mimetype === 'application/pdf') {
            try {
                // Basic options for pdf-parse to be more robust
                const options = {
                    pagerender: function (pageData) {
                        return pageData.getTextContent()
                            .then(function (textContent) {
                                let lastY, text = '';
                                for (let item of textContent.items) {
                                    if (lastY == item.transform[5] || !lastY) {
                                        text += item.str;
                                    }
                                    else {
                                        text += '\n' + item.str;
                                    }
                                    lastY = item.transform[5];
                                }
                                return text;
                            });
                    }
                }
                const data = await pdfParse(req.file.buffer, options);
                resumeText = data.text;
                if (!resumeText || resumeText.trim().length === 0) {
                    return res.status(400).json({ msg: 'PDF text could not be extracted. Try converting to a text-based PDF.' });
                }
            } catch (pdfErr) {
                console.error('PDF Parse Error:', pdfErr);
                return res.status(400).json({ msg: `PDF Error: ${pdfErr.message || 'Corrupt file'}` });
            }
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            try {
                const result = await mammoth.extractRawText({ buffer: req.file.buffer });
                resumeText = result.value;
            } catch (docxErr) {
                console.error('DOCX Parse Error:', docxErr);
                return res.status(400).json({ msg: 'Corrupt or invalid DOCX file.' });
            }
        } else if (req.file.mimetype === 'application/msword') {
            return res.status(400).json({ msg: 'Old .doc format is not supported. Please save as .docx or PDF.' });
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

        // --- AI ENHANCEMENT ---
        let aiReport = null;
        if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY_HERE") {
            try {
                const prompt = `
                    Analyze this resume text against the job description below.
                    Provide a detailed report in JSON format with exactly these keys:
                    "aiScore" (number 0-100),
                    "aiSummary" (string, 2 sentences),
                    "strengths" (array of 3 points),
                    "weaknesses" (array of 3 points),
                    "suggestions" (array of 5 specific action items).

                    Resume Content:
                    ${resumeText.substring(0, 3000)}

                    Job Description:
                    ${jobDescription || "General job market standard"}
                `;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                // Extract JSON if it's wrapped in markers
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    aiReport = JSON.parse(jsonMatch[0]);
                }
            } catch (aiErr) {
                console.error("Gemini AI Analysis failed:", aiErr);
            }
        }

        // --- FALLBACK HEURISTICS (Enhanced NLP) ---
        if (!aiReport) {
            const words = tokenizer.tokenize(resumeText.toLowerCase());

            // 1. Action Verbs Check
            const actionVerbs = ['developed', 'managed', 'led', 'created', 'implemented', 'designed', 'achieved', 'increased', 'coordinated', 'launched'];
            const foundVerbs = actionVerbs.filter(v => resumeText.toLowerCase().includes(v));

            // 2. Quantification Check (Searching for numbers + % or keywords)
            const numbersFound = (resumeText.match(/\d+/g) || []).length;
            const percentFound = (resumeText.match(/%/g) || []).length;
            const quantified = numbersFound > 5 || percentFound > 1;

            const fallbackStrengths = [];
            if (sectionData.found.includes('experience')) fallbackStrengths.push("Professional Experience section is well-structured.");
            if (foundVerbs.length > 3) fallbackStrengths.push(`Strong vocabulary with ${foundVerbs.length} powerful action verbs.`);
            if (quantified) fallbackStrengths.push("Excellent use of data and metrics to quantify achievements.");
            if (sectionData.found.includes('skills')) fallbackStrengths.push("Comprehensive technical skills section detected.");

            const fallbackWeaknesses = [];
            if (sectionData.missing.length > 0) fallbackWeaknesses.push(`Missing critical sections: ${sectionData.missing.join(', ')}.`);
            if (foundVerbs.length < 2) fallbackWeaknesses.push("Weak impact verbs. Use words like 'Spearheaded' or 'Optimized'.");
            if (!quantified) fallbackWeaknesses.push("Achievements are vague. Add more numbers, percentages, or dollar amounts.");
            if (keywordScore < 50) fallbackWeaknesses.push("Low keyword density for modern automated screening systems.");

            const fallbackSuggestions = [
                "Incorporate more industry-specific technical keywords from the Job Description.",
                "Ensure your email and LinkedIn profile are hyperlinked correctly.",
                "Replace passive voice with active power verbs in your experience bullet points.",
                "Add a 'Certifications' or 'Projects' section to highlight continuous learning.",
                "Ensure consistent date formatting (e.g., month/year) throughout the document."
            ];

            // Re-calculate final score based on new heuristics
            let refinedScore = finalScore;
            if (foundVerbs.length > 5) refinedScore += 5;
            if (quantified) refinedScore += 5;
            if (sectionData.missing.length > 2) refinedScore -= 10;

            const finalRefined = Math.min(Math.max(refinedScore, 20), 100);

            aiReport = {
                aiScore: finalRefined,
                aiSummary: finalRefined > 80
                    ? "Impressive resume! Highly professional and optimized for modern ATS filters."
                    : "Consistent formatting, but needs more impact-driven language and keyword targeting.",
                strengths: fallbackStrengths.slice(0, 3).length > 0 ? fallbackStrengths.slice(0, 3) : ["Clean layout", "Readable font size", "Proper file format"],
                weaknesses: fallbackWeaknesses.slice(0, 3),
                suggestions: fallbackSuggestions
            };
        }

        res.json({
            score: aiReport.aiScore,
            summary: aiReport.aiSummary,
            improvements: [
                ...aiReport.weaknesses.map(w => ({ type: 'major', text: w })),
                ...aiReport.suggestions.map(s => ({ type: 'minor', text: s }))
            ],
            aiDetails: {
                strengths: aiReport.strengths,
                weaknesses: aiReport.weaknesses,
                suggestions: aiReport.suggestions
            },
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
