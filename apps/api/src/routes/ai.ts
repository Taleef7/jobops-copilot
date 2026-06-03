import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  analysisFromFit,
  analysisFromParsed,
  validateFitScoreOutput,
  validateParsedJobOutput,
} from '@/lib/analysis-core';
import { resolveFitScore, resolveOutreachDraft, resolveParsedJob } from '@/lib/agent-client';
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
import { exportWeeklyReportMarkdown } from '@/lib/report-export';
import { getRequestBaseUrl } from '@/lib/request-url';
import { buildWeeklyReportRecord, formatWeeklyReportResponse } from '@/lib/weekly-report';
import type { DraftOutreachBody, OutreachDraft, ParseJobBody, ScoreFitBody, WeeklyReportBody } from '@/types';

export const aiRouter = Router();

aiRouter.post('/parse-job', async (request, response, next) => {
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
      const job = await getJobById(body.job_id);
      if (!job) {
        return response.status(404).json({ error: 'Job not found' });
      }

      await saveJobAnalysis(body.job_id, analysisFromParsed(parsed));
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
  const body = request.body as ScoreFitBody;

  if (!body.job_id) {
    return response.status(400).json({ error: 'job_id is required' });
  }

  if (!body.resume_text?.trim() || !body.profile_text?.trim()) {
    return response.status(400).json({ error: 'resume_text and profile_text are required' });
  }

  try {
    const job = await getJobById(body.job_id);
    if (!job) {
      return response.status(404).json({ error: 'Job not found' });
    }

    const scored = await resolveFitScore({
      descriptionText: job.descriptionText,
      resumeText: body.resume_text,
      profileText: body.profile_text,
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

    await saveJobAnalysis(body.job_id, analysis, scored.fit_score);

    return response.json({
      job_id: body.job_id,
      ...scored,
    });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/draft-outreach', async (request, response, next) => {
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
      job = await getJobById(body.job_id);
    } catch (error) {
      next(error);
      return;
    }
  }

  const payload = await resolveOutreachDraft({
    ...body,
    contact_email: contactEmail,
    company: job?.company,
    job_context: body.job_context ?? job?.descriptionText,
    resume_summary: body.resume_summary,
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
      await appendOutreachDraft(job.id, draft);
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
          await updateOutreachGmailDraftId(draft.id, gmailDraft.gmailDraftId);
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

aiRouter.post('/generate-weekly-report', async (request, response, next) => {
  const body = request.body as WeeklyReportBody;

  if (!body.week_start || !body.week_end) {
    return response.status(400).json({ error: 'week_start and week_end are required' });
  }

  try {
    const jobs = await listJobs();
    const report = buildWeeklyReportRecord(jobs, body);
    const reportUrl = await exportWeeklyReportMarkdown(report, {
      publicBaseUrl: getRequestBaseUrl(request),
    });
    const savedReport = await saveWeeklyReport({
      ...report,
      reportUrl,
    });

    return response.json(formatWeeklyReportResponse(savedReport));
  } catch (error) {
    next(error);
  }
});
