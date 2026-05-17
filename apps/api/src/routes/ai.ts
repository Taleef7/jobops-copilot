import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  buildAnalysisFromParse,
  buildAnalysisFromScore,
  parseJobDescription,
  scoreJobFit,
  validateFitScoreOutput,
  validateParsedJobOutput,
} from '@/lib/analysis-core';
import {
  draftOutreachBody,
  generateWeeklyReportBody,
} from '@/data/mock-store';
import { appendOutreachDraft, getJobById, saveJobAnalysis } from '@/data/job-store';
import type { DraftOutreachBody, ParseJobBody, ScoreFitBody, WeeklyReportBody } from '@/types';

export const aiRouter = Router();

aiRouter.post('/parse-job', async (request, response, next) => {
  const body = request.body as ParseJobBody;

  try {
    if (!body.description_text?.trim()) {
      return response.status(400).json({ error: 'description_text is required' });
    }

    const parsed = parseJobDescription(body.description_text);

    if (!validateParsedJobOutput(parsed)) {
      return response.status(500).json({ error: 'AI parser returned an invalid payload' });
    }

    if (body.job_id) {
      const job = await getJobById(body.job_id);
      if (!job) {
        return response.status(404).json({ error: 'Job not found' });
      }

      await saveJobAnalysis(body.job_id, buildAnalysisFromParse(body.description_text));
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

    const scored = scoreJobFit({
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

    const analysis = buildAnalysisFromScore({
      descriptionText: job.descriptionText,
      resumeText: body.resume_text,
      profileText: body.profile_text,
      requiredSkills: job.analysis.requiredSkills,
      preferredSkills: job.analysis.preferredSkills,
      atsKeywords: job.analysis.atsKeywords,
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

  if (!body.message_type) {
    return response.status(400).json({ error: 'message_type is required' });
  }

  const payload = draftOutreachBody(body);
  const draft = {
    id: randomUUID(),
    contactName: body.contact_name,
    contactRole: body.contact_role,
    messageType: body.message_type,
    draftText: payload.draft_text,
    status: 'drafted' as const,
    createdAt: new Date().toISOString(),
  };

  if (body.job_id) {
    try {
      const job = await getJobById(body.job_id);
      if (job) {
        await appendOutreachDraft(body.job_id, draft);
      }
    } catch (error) {
      next(error);
      return;
    }
  }

  return response.json({
    ...payload,
    outreach_id: draft.id,
    job_id: body.job_id ?? null,
  });
});

aiRouter.post('/generate-weekly-report', (request, response) => {
  const body = request.body as WeeklyReportBody;

  if (!body.week_start || !body.week_end) {
    return response.status(400).json({ error: 'week_start and week_end are required' });
  }

  return response.json(generateWeeklyReportBody(body));
});
