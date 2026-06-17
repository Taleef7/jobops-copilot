import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  analysisFromFit,
  analysisFromParsed,
  validateFitScoreOutput,
  validateParsedJobOutput,
} from '@/lib/analysis-core';
import {
  AgentDisabledError,
  resolveFitScore,
  resolveOutreachDraft,
  resolveParsedJob,
  resumeAssistant,
  runAgentTask,
  runAssistant,
} from '@/lib/agent-client';
import { isSingleRecipientEmailAddress } from '@/lib/email';
import { createGmailDraftIfEnabled } from '@/lib/gmail';
import {
  appendOutreachDraft,
  getJobById,
  listJobs,
  saveJobAnalysis,
  updateOutreachGmailDraftId,
} from '@/data/job-store';
import { saveWeeklyReport } from '@/data/report-store';
import { getUserProfile } from '@/data/profile-store';
import { requireUser } from '@/lib/auth';
import { exportWeeklyReportMarkdown } from '@/lib/report-export';
import { getRequestBaseUrl } from '@/lib/request-url';
import { buildWeeklyReportRecord, formatWeeklyReportResponse } from '@/lib/weekly-report';
import type { DraftOutreachBody, OutreachDraft, ParseJobBody, ScoreFitBody, WeeklyReportBody } from '@/types';

export const aiRouter = Router();

aiRouter.post('/parse-job', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as ParseJobBody;

  try {
    if (!body.description_text?.trim()) {
      return response.status(400).json({ error: 'description_text is required' });
    }

    const parsed = await resolveParsedJob(body.description_text);

    if (!validateParsedJobOutput(parsed)) {
      return response.status(500).json({ error: 'AI parser returned an invalid payload' });
    }

    if (body.job_id) {
      const job = await getJobById(userId, body.job_id);
      if (!job) {
        return response.status(404).json({ error: 'Job not found' });
      }

      await saveJobAnalysis(userId, body.job_id, analysisFromParsed(parsed));
    }

    return response.json({
      job_id: body.job_id ?? null,
      ...parsed,
    });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/score-fit', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as ScoreFitBody;

  if (!body.job_id) {
    return response.status(400).json({ error: 'job_id is required' });
  }

  try {
    const job = await getJobById(userId, body.job_id);
    if (!job) {
      return response.status(404).json({ error: 'Job not found' });
    }

    // Fall back to the saved profile so the client doesn't need to resend the
    // resume on every call; require that a resume exists somewhere.
    const profile = await getUserProfile(userId);
    const resumeText = body.resume_text?.trim() || profile?.resumeText || '';
    const profileText = body.profile_text?.trim() || profile?.profileText || resumeText;

    if (!resumeText) {
      return response
        .status(400)
        .json({ error: 'No resume on file. Add your resume in onboarding or settings first.' });
    }

    const scored = await resolveFitScore({
      userId,
      descriptionText: job.descriptionText,
      resumeText,
      profileText,
      requiredSkills: job.analysis.requiredSkills,
      preferredSkills: job.analysis.preferredSkills,
      atsKeywords: job.analysis.atsKeywords,
    });

    if (!validateFitScoreOutput(scored)) {
      return response.status(500).json({ error: 'AI scorer returned an invalid payload' });
    }

    const analysis = analysisFromFit(scored, {
      requiredSkills: job.analysis.requiredSkills,
      preferredSkills: job.analysis.preferredSkills,
    });

    await saveJobAnalysis(userId, body.job_id, analysis, scored.fit_score);

    return response.json({
      job_id: body.job_id,
      ...scored,
    });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/draft-outreach', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as DraftOutreachBody;
  const contactEmail = body.contact_email?.trim();

  if (!body.message_type) {
    return response.status(400).json({ error: 'message_type is required' });
  }
  if (contactEmail && !isSingleRecipientEmailAddress(contactEmail)) {
    return response.status(400).json({ error: 'contact_email must be a valid email address' });
  }

  let job: Awaited<ReturnType<typeof getJobById>> = undefined;
  if (body.job_id) {
    try {
      job = await getJobById(userId, body.job_id);
    } catch (error) {
      next(error);
      return;
    }
  }

  const profile = await getUserProfile(userId);
  const payload = await resolveOutreachDraft({
    ...body,
    contact_email: contactEmail,
    company: job?.company,
    job_context: body.job_context ?? job?.descriptionText,
    resume_summary: body.resume_summary ?? profile?.profileText ?? profile?.resumeText,
  });
  const draft: OutreachDraft = {
    id: randomUUID(),
    jobId: body.job_id ?? undefined,
    contactName: body.contact_name,
    contactRole: body.contact_role,
    email: contactEmail || undefined,
    messageType: body.message_type,
    draftText: payload.draft_text,
    status: 'drafted' as const,
    createdAt: new Date().toISOString(),
    gmailDraftId: undefined,
  };

  let gmailDraftStatus: 'created' | 'skipped' | 'failed' = 'skipped';
  let gmailDraftMessage = 'Gmail draft support is disabled by feature flag.';

  if (job) {
    try {
      await appendOutreachDraft(userId, job.id, draft);
    } catch (error) {
      next(error);
      return;
    }
  }

  try {
    const gmailDraft = await createGmailDraftIfEnabled({
      recipientEmail: contactEmail ?? '',
      subject: payload.subject,
      bodyText: payload.draft_text,
    });
    gmailDraftStatus = gmailDraft.status;
    gmailDraftMessage = gmailDraft.message;

    if (gmailDraft.gmailDraftId) {
      draft.gmailDraftId = gmailDraft.gmailDraftId;

      if (job) {
        try {
          await updateOutreachGmailDraftId(userId, draft.id, gmailDraft.gmailDraftId);
        } catch (error) {
          gmailDraftMessage = `${gmailDraft.message} The local outreach record could not be updated.`;
          console.error('Gmail draft created but local outreach update failed', error);
        }
      }
    }
  } catch (error) {
    gmailDraftStatus = 'failed';
    gmailDraftMessage = error instanceof Error ? error.message : 'Failed to create the Gmail draft.';
    console.error('Gmail draft creation failed', {
      error,
      jobId: body.job_id ?? null,
      outreachId: draft.id,
    });
  }

  return response.json({
    ...payload,
    outreach_id: draft.id,
    job_id: body.job_id ?? null,
    gmail_draft_status: gmailDraftStatus,
    gmail_draft_id: draft.gmailDraftId ?? null,
    gmail_draft_message: gmailDraftMessage,
  });
});

const AGENT_DISABLED_MESSAGE =
  'The AI agent service is not configured. Set AGENT_SERVICE_URL and a provider key to enable the agents.';

aiRouter.post('/agents/interview-prep', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as { job_id?: string; resume_text?: string };

  if (!body.job_id) {
    return response.status(400).json({ error: 'job_id is required' });
  }

  try {
    const job = await getJobById(userId, body.job_id);
    if (!job) {
      return response.status(404).json({ error: 'Job not found' });
    }

    const profile = await getUserProfile(userId);
    const result = await runAgentTask('/agents/interview-prep', {
      job_description: job.descriptionText,
      resume_text: body.resume_text ?? profile?.resumeText,
      company: job.company,
      role: job.title,
    });

    return response.json(result);
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
    }
    next(error);
  }
});

aiRouter.post('/agents/research', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as { job_id?: string };

  if (!body.job_id) {
    return response.status(400).json({ error: 'job_id is required' });
  }

  try {
    const job = await getJobById(userId, body.job_id);
    if (!job) {
      return response.status(404).json({ error: 'Job not found' });
    }

    const result = await runAgentTask('/agents/research', {
      company: job.company,
      role: job.title,
      context: job.descriptionText,
    });

    return response.json(result);
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
    }
    next(error);
  }
});

aiRouter.post('/agents/skill-gap', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as { job_id?: string; resume_text?: string };

  if (!body.job_id) {
    return response.status(400).json({ error: 'job_id is required' });
  }

  try {
    const job = await getJobById(userId, body.job_id);
    if (!job) {
      return response.status(404).json({ error: 'Job not found' });
    }

    const profile = await getUserProfile(userId);
    const result = await runAgentTask('/agents/skill-gap', {
      missing_skills: job.analysis.missingSkills,
      job_description: job.descriptionText,
      resume_text: body.resume_text ?? profile?.resumeText,
    });

    return response.json(result);
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
    }
    next(error);
  }
});

aiRouter.post('/assistant/run', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as { description_text?: string; resume_text?: string; profile_text?: string };
  if (!body.description_text?.trim()) {
    return response.status(400).json({ error: 'description_text is required' });
  }

  try {
    const result = await runAssistant({
      descriptionText: body.description_text,
      resumeText: body.resume_text,
      profileText: body.profile_text,
      userId,
    });
    return response.json(result);
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
    }
    next(error);
  }
});

aiRouter.post('/assistant/resume', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as { thread_id?: string; approved?: boolean };
  if (!body.thread_id?.trim()) {
    return response.status(400).json({ error: 'thread_id is required' });
  }

  try {
    const result = await resumeAssistant(body.thread_id, Boolean(body.approved));
    return response.json(result);
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
    }
    next(error);
  }
});

aiRouter.post('/generate-weekly-report', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as WeeklyReportBody;

  if (!body.week_start || !body.week_end) {
    return response.status(400).json({ error: 'week_start and week_end are required' });
  }

  try {
    const jobs = await listJobs(userId);
    const report = buildWeeklyReportRecord(jobs, body);
    const reportUrl = await exportWeeklyReportMarkdown(report, {
      publicBaseUrl: getRequestBaseUrl(request),
    });
    const savedReport = await saveWeeklyReport(userId, {
      ...report,
      reportUrl,
    });

    return response.json(formatWeeklyReportResponse(savedReport));
  } catch (error) {
    next(error);
  }
});
