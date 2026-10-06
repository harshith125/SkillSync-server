const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

/**
 * Fallback scoring algorithm if Gemini is unavailable
 */
const fallbackEvaluation = (job, candidate, resumeText = '') => {
    const jobSkills = (job.requirements || []).map(s => s.toLowerCase().trim());
    const candidateSkills = (candidate.skills || []).map(s => s.toLowerCase().trim());
    const textToSearch = `${candidateSkills.join(' ')} ${resumeText.toLowerCase()} ${(candidate.experience?.description || '').toLowerCase()}`;

    let matchedSkills = [];
    let missingSkills = [];

    jobSkills.forEach(skill => {
        if (textToSearch.includes(skill)) {
            matchedSkills.push(skill);
        } else {
            missingSkills.push(skill);
        }
    });

    const skillScore = jobSkills.length > 0 ? (matchedSkills.length / jobSkills.length) * 60 : 50;

    // Experience match (up to 30%)
    const candidateExp = candidate.experience?.years || 0;
    const requiredExp = job.experienceRequired || 0;
    let expScore = 15;
    if (requiredExp > 0) {
        if (candidateExp >= requiredExp) {
            expScore = 30;
        } else {
            expScore = Math.max(5, Math.round((candidateExp / requiredExp) * 30));
        }
    } else {
        expScore = 25;
    }

    // Baseline points (10%)
    const finalScore = Math.min(100, Math.round(skillScore + expScore + 10));

    return {
        score: finalScore,
        summary: `Matches ${matchedSkills.length} of ${jobSkills.length} required skills. Has ${candidateExp} year(s) experience (Required: ${requiredExp} yrs).`,
        strengths: matchedSkills.length > 0 ? matchedSkills.map(s => `Proficient in ${s}`) : ['Relevant background'],
        weaknesses: missingSkills.length > 0 ? missingSkills.map(s => `Missing ${s}`) : ['No major skill gaps identified']
    };
};

/**
 * Analyze candidate profile + resume text against job using Gemini AI
 */
const evaluateCandidateWithGemini = async (job, candidate, resumeText = '') => {
    try {
        if (!process.env.GEMINI_API_KEY || !genAI) {
            console.log('Gemini API key not found, using algorithmic evaluation');
            return fallbackEvaluation(job, candidate, resumeText);
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });

        const prompt = `
You are an expert HR and Technical Recruiter AI evaluating a candidate for a job opening.

JOB DETAILS:
- Title: ${job.title}
- Description: ${job.description}
- Required Skills: ${(job.requirements || []).join(', ')}
- Required Experience: ${job.experienceRequired} years

CANDIDATE DETAILS:
- Name: ${candidate.fullName || 'Candidate'}
- Declared Skills: ${(candidate.skills || []).join(', ')}
- Experience: ${candidate.experience?.years || 0} years - ${candidate.experience?.description || 'N/A'}
- Degree/Education: ${candidate.education?.degree?.name || ''} from ${candidate.education?.degree?.college || ''} (Score: ${candidate.education?.degree?.score || 'N/A'})

RESUME TEXT EXTRACT (First 3500 chars):
${resumeText.slice(0, 3500)}

TASK:
Evaluate candidate fit for this role. Return ONLY a valid JSON object (no markdown code blocks, no backticks, just raw JSON) with this exact schema:
{
  "score": <number between 10 and 100 representing overall match percentage>,
  "summary": "<2-3 sentence clear summary of candidate fit, highlighting why they are ranked at this score>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<gap 1>", "<gap 2>"]
}
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        // Clean out possible markdown code backticks
        const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanJson);

        return {
            score: Math.min(100, Math.max(10, Math.round(Number(parsed.score) || 70))),
            summary: parsed.summary || 'Candidate analyzed by Gemini AI.',
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
            weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 5) : []
        };
    } catch (err) {
        console.error('Gemini evaluation error (falling back to algorithm):', err.message);
        return fallbackEvaluation(job, candidate, resumeText);
    }
};

module.exports = {
    evaluateCandidateWithGemini,
    fallbackEvaluation
};
