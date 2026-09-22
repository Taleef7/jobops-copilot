import { Router } from 'express';
import { listAgentOutputs } from '@/data/agent-output-store';
import { listApplicationAnswers, upsertApplicationAnswer } from '@/data/application-answer-store';
import { createJob, getJobById, listJobs, updateJob } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion } from '@/data/resume-version-store';
import { buildApplicationPack } from '@/routes/application-pack';
import type { ApplicationPackPayload, JobRecord } from '@/types';
import { extLimiter, requireExtToken } from './middleware';

export const extRouter = Router();

// Apply rate limiting and PAT auth to all /api/ext routes
extRouter.use(requireExtToken);
extRouter.use(extLimiter);

/**
 * Health/verification endpoint for the Chrome extension options page.
 * Returns the authenticated user's ID and token metadata when the PAT is valid.
 */
extRouter.get('/verify', (request, response) => {
  response.json({
    ok: true,
    userId: request.userId,
    token: request.extToken
      ? {
          id: request.extToken.id,
          label: request.extToken.label,
          createdAt: request.extToken.createdAt,
          lastUsedAt: request.extToken.lastUsedAt,
        }
      : undefined,
  });
});

function normalizeUrlForMatching(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname}${pathname}`.toLowerCase();
  } catch {
    return rawUrl.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * GET /api/ext/match?url=...
 * Resolves current ATS tab URL against user's jobs in CRM.
 * If matched, returns the job + application pack (assembles on-the-fly if needed).
 * If not matched, returns matched: false with recent jobs for manual selection fallback.
 */
extRouter.get('/match', async (request, response, next) => {
  try {
    const userId = request.userId!;
    const rawUrl = typeof request.query.url === 'string' ? request.query.url.trim() : '';

    const allJobs = await listJobs(userId);
    let matchedJob: JobRecord | undefined;

    if (rawUrl) {
      const targetNorm = normalizeUrlForMatching(rawUrl);

      // 1. Exact or normalized URL match
      matchedJob = allJobs.find((j) => {
        if (!j.jobUrl) return false;
        if (j.jobUrl === rawUrl) return true;
        const jNorm = normalizeUrlForMatching(j.jobUrl);
        return jNorm === targetNorm;
      });

      // 2. Path segment / job ID match (e.g. /jobs/12345 or /postings/12345)
      if (!matchedJob) {
        try {
          const parsed = new URL(rawUrl);
          const segments = parsed.pathname.split('/').filter(Boolean);
          const lastSegment = segments[segments.length - 1];
          if (lastSegment && lastSegment.length >= 4) {
            matchedJob = allJobs.find((j) => j.jobUrl && j.jobUrl.includes(lastSegment));
          }
        } catch {
          // ignore URL parse failure
        }
      }
    }

    if (matchedJob) {
      // Find existing application pack output
      const outputs = await listAgentOutputs(userId, matchedJob.id);
      const existingPack = outputs.find((o) => o.kind === 'application_pack');
      const applicationPack = existingPack
        ? (existingPack.payload as ApplicationPackPayload)
        : await buildApplicationPack(userId, matchedJob);

      return response.json({
        matched: true,
        job: matchedJob,
        applicationPack,
      });
    }

    // Manual picker fallback: return top 10 most recent active/pipeline jobs
    const recentJobs = allJobs
      .filter((j) => j.status !== 'archived')
      .slice(0, 10);

    return response.json({
      matched: false,
      job: null,
      applicationPack: null,
      recentJobs,
    });
  } catch (error) {
    next(error);
  }
});

function splitName(fullName?: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? '', lastName: '' };
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

/**
 * GET /api/ext/profile-fill
 * Returns a flattened key-value field map of profile, contact info, and base resume.
 * ATS autofill scripts query this to populate application form fields.
 */
extRouter.get('/profile-fill', async (request, response, next) => {
  try {
    const userId = request.userId!;
    const [baseVersion, profile, answersList] = await Promise.all([
      getBaseResumeVersion(userId),
      getUserProfile(userId),
      listApplicationAnswers(userId),
    ]);

    const resume = baseVersion?.structuredResume || profile?.baseResume;
    const basics = resume?.basics;
    const { firstName, lastName } = splitName(basics?.name);

    let linkedinUrl: string = '';
    let githubUrl: string = '';
    for (const p of basics?.profiles || []) {
      const net = (p.network || '').toLowerCase();
      if (net.includes('linkedin')) linkedinUrl = p.url || '';
      else if (net.includes('github')) githubUrl = p.url || '';
    }

    const answersMap: Record<string, string> = {};
    for (const a of answersList) {
      answersMap[a.questionHash] = a.answer;
      answersMap[a.questionText.toLowerCase().trim()] = a.answer;
    }

    return response.json({
      profile: {
        fullName: basics?.name || '',
        firstName,
        lastName,
        email: basics?.email || '',
        phone: basics?.phone || '',
        location: [basics?.location?.city, basics?.location?.region].filter(Boolean).join(', '),
        city: basics?.location?.city || '',
        state: basics?.location?.region || '',
        country: basics?.location?.countryCode || 'United States',
        postalCode: basics?.location?.postalCode || '',
        linkedinUrl,
        githubUrl,
        portfolioUrl: basics?.url || '',
        websiteUrl: basics?.url || '',
        summary: basics?.summary || '',
        currentTitle: resume?.work?.[0]?.position || basics?.label || '',
        currentCompany: resume?.work?.[0]?.company || '',
        workAuthorization: {
          authorizedInUS: true,
          requireSponsorship: false,
        },
      },
      workExperience: resume?.work || [],
      education: resume?.education || [],
      skills: resume?.skills?.flatMap((s) => s.skills) || [],
      answers: answersMap,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ext/answers?q=...
 * Query Q&A memory for matching answers.
 */
extRouter.get('/answers', async (request, response, next) => {
  try {
    const userId = request.userId!;
    const query = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase() : '';

    const answers = await listApplicationAnswers(userId);
    const filtered = query
      ? answers.filter((a) => a.questionText.toLowerCase().includes(query))
      : answers;

    return response.json({ answers: filtered });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ext/answers
 * Saves a new or updated answer into permanent Q&A memory from the extension.
 */
extRouter.post('/answers', async (request, response, next) => {
  try {
    const userId = request.userId!;
    const { questionText, answer, ats } = request.body as {
      questionText?: string;
      answer?: string;
      ats?: string;
    };

    if (!questionText || typeof questionText !== 'string' || !questionText.trim()) {
      return response.status(400).json({ error: 'questionText is required' });
    }
    if (!answer || typeof answer !== 'string' || !answer.trim()) {
      return response.status(400).json({ error: 'answer is required' });
    }

    const saved = await upsertApplicationAnswer(userId, {
      questionText: questionText.trim(),
      answer: answer.trim(),
      ats: ats?.trim() || undefined,
    });

    return response.status(201).json({ answer: saved });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ext/applications
 * Captures submission confirmation from the Chrome extension:
 * Transitions job status to 'applied', notes timestamp, ATS name, and next action.
 */
extRouter.post('/applications', async (request, response, next) => {
  try {
    const userId = request.userId!;
    const {
      jobId,
      jobUrl,
      company,
      title,
      atsName,
      confirmationUrl,
      notes,
    } = request.body as {
      jobId?: string;
      jobUrl?: string;
      company?: string;
      title?: string;
      atsName?: string;
      confirmationUrl?: string;
      notes?: string;
    };

    let targetJob: JobRecord | undefined;

    if (jobId) {
      targetJob = await getJobById(userId, jobId);
    }

    if (!targetJob && jobUrl) {
      const all = await listJobs(userId);
      const targetNorm = normalizeUrlForMatching(jobUrl);
      targetJob = all.find((j) => j.jobUrl && normalizeUrlForMatching(j.jobUrl) === targetNorm);
    }

    const atsLabel = atsName || 'ATS';
    const captureNote = `Application submitted via Chrome Extension (${atsLabel})${
      confirmationUrl ? ` · Confirmation: ${confirmationUrl}` : ''
    }${notes ? ` · Note: ${notes}` : ''}`;

    if (targetJob) {
      const updatedNotes = targetJob.notes ? `${targetJob.notes}\n${captureNote}` : captureNote;
      const oneWeekOut = new Date(Date.now() + 7 * 86400000).toISOString();

      const updated = await updateJob(userId, targetJob.id, {
        status: 'applied',
        nextAction: `Follow up on application with ${targetJob.company}`,
        nextActionDue: oneWeekOut,
        notes: updatedNotes,
      });

      return response.json({
        success: true,
        jobId: targetJob.id,
        status: 'applied',
        job: updated,
        created: false,
      });
    }

    // Auto-create in tracker if not already present
    if (company && title) {
      const newJob = await createJob(userId, {
        company: company.trim(),
        title: title.trim(),
        jobUrl: jobUrl?.trim() || '',
        source: 'manual',
        descriptionText: `Captured application via Chrome Extension on ${atsLabel}.`,
        status: 'applied',
        notes: captureNote,
        nextAction: `Follow up on application with ${company.trim()}`,
      });

      return response.status(201).json({
        success: true,
        jobId: newJob.id,
        status: 'applied',
        job: newJob,
        created: true,
      });
    }

    return response.status(400).json({
      error: 'Either jobId, or matching jobUrl, or company and title must be provided',
    });
  } catch (error) {
    next(error);
  }
});
