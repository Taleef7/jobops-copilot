import { Router } from 'express';
import { listAgentOutputs, saveAgentOutput } from '@/data/agent-output-store';
import { hashQuestion, listApplicationAnswers } from '@/data/application-answer-store';
import { getJobById } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion, listResumeVersionsForJob } from '@/data/resume-version-store';
import { requireUser } from '@/lib/auth';
import type {
  ApplicationPackContactBlock,
  ApplicationPackPayload,
  ApplicationPackQuestionAnswer,
  StructuredResume,
} from '@/types';

export const applicationPackRouter = Router({ mergeParams: true });

function buildContactBlock(resume?: StructuredResume | null): ApplicationPackContactBlock {
  if (!resume?.basics) return {};
  const { basics } = resume;
  const locParts = [basics.location?.city, basics.location?.region].filter(Boolean);
  const location = locParts.length ? locParts.join(', ') : undefined;

  let linkedin: string | undefined;
  let github: string | undefined;
  for (const prof of basics.profiles || []) {
    const net = (prof.network || '').toLowerCase();
    if (net.includes('linkedin')) linkedin = prof.url;
    else if (net.includes('github')) github = prof.url;
  }

  return {
    name: basics.name,
    email: basics.email,
    phone: basics.phone,
    location,
    linkedin,
    github,
    portfolio: basics.url,
  };
}

/**
 * GET /api/jobs/:id/application-pack
 * Returns the persisted application pack for this job if already generated.
 */
applicationPackRouter.get('/jobs/:id/application-pack', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id;
    if (!jobId) {
      return response.status(400).json({ error: 'jobId is required' });
    }

    const job = await getJobById(userId, jobId);
    if (!job) {
      return response.status(404).json({ error: `Job not found: ${jobId}` });
    }

    const outputs = await listAgentOutputs(userId, jobId);
    const existing = outputs.find((o) => o.kind === 'application_pack');

    if (!existing) {
      return response.status(404).json({ error: 'Application pack not found' });
    }

    return response.json({
      applicationPack: existing.payload as ApplicationPackPayload,
      generatedAt: existing.createdAt,
      modelUsed: existing.modelUsed,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/jobs/:id/application-pack
 * Assembles and persists an application pack for this job.
 */
applicationPackRouter.post('/jobs/:id/application-pack', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id;
    if (!jobId) {
      return response.status(400).json({ error: 'jobId is required' });
    }

    const job = await getJobById(userId, jobId);
    if (!job) {
      return response.status(404).json({ error: `Job not found: ${jobId}` });
    }

    // 1. Load base resume & user profile
    const baseVersion = await getBaseResumeVersion(userId);
    const profile = await getUserProfile(userId);
    const baseResume = baseVersion?.structuredResume || profile?.baseResume;

    // 2. Load latest tailored resume version for this job (prefer approved)
    const resumeVersions = await listResumeVersionsForJob(userId, jobId);
    const selectedResume = resumeVersions.find((v) => v.approved) || resumeVersions[0];

    // 3. Load cover letter if any
    const coverLetterDraft = job.outreach?.find((o) => o.messageType === 'cover_letter');

    // 4. Load Q&A memory
    const qaMemory = await listApplicationAnswers(userId);
    const memoryMap = new Map<string, string>();
    for (const item of qaMemory) {
      memoryMap.set(item.questionHash, item.answer);
    }

    // 5. Load research brief if present
    const outputs = await listAgentOutputs(userId, jobId);
    const researchBrief = outputs.find((o) => o.kind === 'research')?.payload as
      | Record<string, unknown>
      | undefined;

    // 6. Build Answers
    const answers: ApplicationPackQuestionAnswer[] = [];
    const flaggedQuestions: string[] = [];

    // Question 1: Work Authorization
    const q1Text = 'Are you legally authorized to work in the United States?';
    const q1Hash = hashQuestion(q1Text);
    if (memoryMap.has(q1Hash)) {
      answers.push({
        questionText: q1Text,
        questionHash: q1Hash,
        answer: memoryMap.get(q1Hash)!,
        category: 'work_authorization',
        source: 'qa_memory',
        flagged: false,
      });
    } else {
      answers.push({
        questionText: q1Text,
        questionHash: q1Hash,
        answer: 'Yes',
        category: 'work_authorization',
        source: 'profile',
        flagged: false,
      });
    }

    // Question 2: Visa Sponsorship
    const q2Text = 'Will you now or in the future require visa sponsorship?';
    const q2Hash = hashQuestion(q2Text);
    if (memoryMap.has(q2Hash)) {
      answers.push({
        questionText: q2Text,
        questionHash: q2Hash,
        answer: memoryMap.get(q2Hash)!,
        category: 'work_authorization',
        source: 'qa_memory',
        flagged: false,
      });
    } else {
      answers.push({
        questionText: q2Text,
        questionHash: q2Hash,
        answer: 'No',
        category: 'work_authorization',
        source: 'profile',
        flagged: false,
      });
    }

    // Question 3: Salary Expectation
    const q3Text = 'What are your salary expectations for this role?';
    const q3Hash = hashQuestion(q3Text);
    if (memoryMap.has(q3Hash)) {
      answers.push({
        questionText: q3Text,
        questionHash: q3Hash,
        answer: memoryMap.get(q3Hash)!,
        category: 'salary',
        source: 'qa_memory',
        flagged: false,
      });
    } else {
      // If no stored salary in Q&A memory, provide market rate answer but flag for review
      answers.push({
        questionText: q3Text,
        questionHash: q3Hash,
        answer: 'Competitive with market rate for this role and seniority, open to discussing total compensation.',
        category: 'salary',
        source: 'generated',
        flagged: true,
      });
      flaggedQuestions.push(q3Text);
    }

    // Question 4: Why Us
    const q4Text = `Why are you interested in joining ${job.company}?`;
    const q4Hash = hashQuestion(q4Text);
    if (memoryMap.has(q4Hash)) {
      answers.push({
        questionText: q4Text,
        questionHash: q4Hash,
        answer: memoryMap.get(q4Hash)!,
        category: 'why_us',
        source: 'qa_memory',
        flagged: false,
      });
    } else {
      const summarySnippet = researchBrief && typeof researchBrief.brief === 'string'
        ? researchBrief.brief.slice(0, 100).trim()
        : `innovative engineering and mission-driven products`;

      answers.push({
        questionText: q4Text,
        questionHash: q4Hash,
        answer: `I am enthusiastic about ${job.company}'s work in ${summarySnippet}. The ${job.title} role aligns directly with my engineering background and passion for building high-impact systems.`,
        category: 'why_us',
        source: researchBrief ? 'research' : 'generated',
        flagged: false,
      });
    }

    // Question 5: Relevant experience
    const q5Text = `Briefly describe your most relevant experience for the ${job.title} position.`;
    const q5Hash = hashQuestion(q5Text);
    if (memoryMap.has(q5Hash)) {
      answers.push({
        questionText: q5Text,
        questionHash: q5Hash,
        answer: memoryMap.get(q5Hash)!,
        category: 'behavioral',
        source: 'qa_memory',
        flagged: false,
      });
    } else {
      let expSummary = `I have extensive experience delivering robust software solutions matching the requirements of ${job.title}.`;
      if (baseResume?.work && baseResume.work.length > 0) {
        const recent = baseResume.work[0]!;
        expSummary = `Most recently as ${recent.position} at ${recent.company}, I led engineering initiatives and delivered high-quality software aligned with ${job.title} requirements.`;
      }
      answers.push({
        questionText: q5Text,
        questionHash: q5Hash,
        answer: expSummary,
        category: 'behavioral',
        source: 'profile',
        flagged: false,
      });
    }

    const packPayload: ApplicationPackPayload = {
      jobId,
      company: job.company,
      title: job.title,
      resumeVersionId: selectedResume?.id ?? null,
      resumeFileUrl: selectedResume?.tailoredResumeFileUrl ?? null,
      coverLetterId: coverLetterDraft?.id ?? null,
      coverLetterText: coverLetterDraft?.draftText ?? null,
      contactBlock: buildContactBlock(baseResume),
      answers,
      flaggedQuestions,
      generatedAt: new Date().toISOString(),
    };

    // 7. Persist to agent_outputs
    await saveAgentOutput(userId, jobId, 'application_pack', packPayload, 'apply-copilot-v1');

    return response.status(201).json({
      applicationPack: packPayload,
      generatedAt: packPayload.generatedAt,
      modelUsed: 'apply-copilot-v1',
    });
  } catch (error) {
    next(error);
  }
});
