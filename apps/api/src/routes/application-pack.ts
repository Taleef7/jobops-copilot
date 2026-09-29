import { Router } from 'express';
import { listAgentOutputs, saveAgentOutput } from '@/data/agent-output-store';
import { hashQuestion, listApplicationAnswers } from '@/data/application-answer-store';
import { getJobById } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion, listResumeVersionsForJob } from '@/data/resume-version-store';
import { requireUser } from '@/lib/auth';
import { detectJobCountry } from '@/lib/job-country';
import type {
  ApplicationAnswer,
  ApplicationPackContactBlock,
  ApplicationPackPayload,
  ApplicationPackQuestionAnswer,
  JobRecord,
  StructuredResume,
} from '@/types';

export const applicationPackRouter = Router({ mergeParams: true });

/** No model writes the pack: it is assembled from the user's saved answers. */
const PACK_MODEL = 'template';

const AUTH_QUESTION = /^Are you legally authorized to work in (.+)\?$/i;
const SPONSOR_QUESTION = /^Will you now or in the future require visa sponsorship to work in (.+)\?$/i;
const UNKNOWN_COUNTRY = 'the country where this role is based';

/** Saved answers to a country-specific question, one per named country. */
function savedAnswersByCountry(memory: ApplicationAnswer[], pattern: RegExp) {
  const byCountry = new Map<string, string>();
  for (const item of memory) {
    const match = pattern.exec(item.questionText.trim());
    const country = match?.[1]?.trim();
    if (country && country.toLowerCase() !== UNKNOWN_COUNTRY) byCountry.set(country, item.answer);
  }
  return [...byCountry].map(([country, answer]) => ({ country, answer }));
}

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

export async function buildApplicationPack(userId: string, job: JobRecord): Promise<ApplicationPackPayload> {
  const jobId = job.id;
  // 1. Load base resume & user profile
  const baseVersion = await getBaseResumeVersion(userId);
  const profile = await getUserProfile(userId);
  const baseResume = baseVersion?.structuredResume || profile?.baseResume;

  // 2. Load latest tailored resume version for this job (prefer approved)
  const resumeVersions = await listResumeVersionsForJob(userId, jobId);
  const selectedResume = resumeVersions.find((v) => v.approved) || resumeVersions[0];

  // 3. Load cover letter if any
  const coverLetterDraft = job.outreach?.find((o) => o.messageType === 'cover_letter');

  // 4. Load Q&A memory: the only source for legal, money and narrative answers.
  const qaMemory = await listApplicationAnswers(userId);
  const memoryMap = new Map<string, string>();
  for (const item of qaMemory) {
    memoryMap.set(item.questionHash, item.answer);
  }

  // 5. Build answers. Nothing here is guessed from the job posting or the résumé:
  // an answer is either the user's own saved answer, or blank and flagged (#343).
  const answers: ApplicationPackQuestionAnswer[] = [];

  const saved = (questionText: string, category: ApplicationPackQuestionAnswer['category']) => {
    const questionHash = hashQuestion(questionText);
    const answer = memoryMap.get(questionHash);
    return { questionText, questionHash, answer, category };
  };
  const pushSaved = (q: ReturnType<typeof saved>) =>
    answers.push({
      questionText: q.questionText,
      questionHash: q.questionHash,
      answer: q.answer!,
      category: q.category,
      source: 'qa_memory',
      needsReview: false,
      flagged: false,
      note: 'Your saved answer.',
    });
  const pushBlank = (q: ReturnType<typeof saved>, note: string) =>
    answers.push({
      questionText: q.questionText,
      questionHash: q.questionHash,
      answer: '',
      category: q.category,
      source: 'unanswerable',
      needsReview: true,
      flagged: true,
      note,
    });

  // Work authorization and sponsorship are asked for the job's country when the
  // location names one. Saved answers are keyed by question text, so an answer for
  // one country can never answer another country's question.
  const country = detectJobCountry(job.location);
  const where = country ?? 'the country where this role is based';
  const legalQuestions = [
    { text: `Are you legally authorized to work in ${where}?`, pattern: AUTH_QUESTION },
    { text: `Will you now or in the future require visa sponsorship to work in ${where}?`, pattern: SPONSOR_QUESTION },
  ];
  const pushForReview = (q: ReturnType<typeof saved>, answer: string, note: string) =>
    answers.push({
      questionText: q.questionText,
      questionHash: q.questionHash,
      answer,
      category: 'work_authorization',
      source: 'qa_memory',
      needsReview: true,
      flagged: true,
      note,
    });
  for (const { text, pattern } of legalQuestions) {
    const q = saved(text, 'work_authorization');
    // A saved answer is final only when it names this job's country.
    if (country && q.answer) {
      pushSaved(q);
      continue;
    }
    if (!country) {
      // The countryless question is shared by every job whose country is unknown, so
      // an answer confirmed for one of them is only ever offered for review.
      if (q.answer) {
        pushForReview(
          q,
          q.answer,
          `Based on the answer you gave for another role whose country wasn't stated. Confirm it applies to this one.`,
        );
        continue;
      }
      // Otherwise offer the user's answer only when they saved exactly one country's.
      const savedCountries = savedAnswersByCountry(qaMemory, pattern);
      if (savedCountries.length === 1) {
        const [only] = savedCountries;
        pushForReview(
          q,
          only!.answer,
          `Based on your saved answer for ${only!.country}. JobOps couldn't tell which country this role is in from its location, so confirm it applies.`,
        );
        continue;
      }
    }
    pushBlank(
      q,
      country
        ? `Answer this yourself. It's a legal question, so it is never filled in for you.`
        : `JobOps couldn't tell which country this role is in from its location. Answer this yourself.`,
    );
  }

  // Expected salary: only the user's own saved answer to this exact question.
  // Never the posted salary, and never a saved "current salary".
  const salary = saved('What are your salary expectations for this role?', 'salary');
  if (salary.answer) pushSaved(salary);
  else pushBlank(salary, 'Enter your own expectation. The posted salary range is not used.');

  // Narrative answers are the user's to write.
  const whyUs = saved(`Why are you interested in joining ${job.company}?`, 'why_us');
  if (whyUs.answer) pushSaved(whyUs);
  else pushBlank(whyUs, 'Write this in your own words. The company research on the AI agents tab can help.');

  const experience = saved(`Briefly describe your most relevant experience for the ${job.title} position.`, 'behavioral');
  if (experience.answer) pushSaved(experience);
  else pushBlank(experience, 'Write this from your résumé in your own words.');

  const flaggedQuestions = answers.filter((a) => a.needsReview).map((a) => a.questionText);

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

  return packPayload;
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

    // Packs built before #343 hold invented answers. Migration 024 deletes them from
    // Postgres, but the file-backed store never runs migrations, so a pack is only
    // served if this builder made it. Otherwise the UI offers to generate a new one.
    if (!existing || existing.modelUsed !== PACK_MODEL) {
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

    const packPayload = await buildApplicationPack(userId, job);

    // Persist to agent_outputs
    await saveAgentOutput(userId, jobId, 'application_pack', packPayload, PACK_MODEL);

    return response.status(201).json({
      applicationPack: packPayload,
      generatedAt: packPayload.generatedAt,
      modelUsed: PACK_MODEL,
    });
  } catch (error) {
    next(error);
  }
});
