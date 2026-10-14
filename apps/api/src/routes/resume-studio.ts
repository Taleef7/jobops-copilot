import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getJobById } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import {
  getBaseResumeVersion,
  getResumeVersion,
  insertResumeVersion,
  listResumeVersionsForJob,
  updateResumeVersion,
} from '@/data/resume-version-store';
import { AiUnavailableError, normalizeStructuredResume, resolveTailorResume } from '@/lib/agent-client';
import { renderAtsResumePdf } from '@/lib/ats-resume-pdf';
import { requireUser } from '@/lib/auth';
import { storeResumePdf } from '@/lib/resume-storage';
import { GROUNDING_VERSION, isGrounded, tailorFromAnswer } from '@/lib/tailor/apply';
import { isInjectionRefusal } from '@/lib/tailor/answer';
import { editableLines } from '@/lib/tailor/lines';
import { attachmentDisposition } from '@/lib/content-disposition';
import { buildTailorRequest, parseConfirmedKeywords, postingKeywords } from '@/lib/tailor/request';
import type { ResumeVersionRecord } from '@/types';

export const resumeStudioRouter = Router();

const NOT_GROUNDED = {
  code: 'NOT_GROUNDED',
  error: "This draft wasn't checked against your base résumé, so it can't be used. Tailor it again.",
};

/**
 * POST /api/jobs/:id/tailor   body: { confirmedKeywords?: string[] }
 *
 * Tailors the base résumé to the job's posting (#351). The AI suggests edits to the summary
 * and bullets; the API applies the ones its grounding check accepts (lib/tailor) and saves a
 * draft that records what it was based on. A suggestion that adds a fact is dropped and shown
 * as dropped. `confirmedKeywords` are keywords the user said they have in the tailor window.
 *
 * - 409 BASE_RESUME_EMPTY / POSTING_EMPTY: nothing to tailor; the AI is not called.
 * - 503 retryable: the AI couldn't answer usefully; nothing is saved.
 * The strict limiter and the AI budget are mounted in app.ts (route inventory, #345).
 */
resumeStudioRouter.post('/jobs/:id/tailor', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id!;
    const job = await getJobById(userId, jobId);
    if (!job) {
      return response.status(404).json({ error: `Job not found: ${jobId}` });
    }

    const confirmedKeywords = parseConfirmedKeywords((request.body ?? {}).confirmedKeywords);
    if (!confirmedKeywords) {
      return response.status(400).json({ error: 'confirmedKeywords must be a list of up to 25 keywords of up to 60 characters.' });
    }

    // The base résumé as Settings shows it: the profile's copy, else the base version.
    const [profile, baseVersion] = await Promise.all([getUserProfile(userId), getBaseResumeVersion(userId)]);
    const base = normalizeStructuredResume(profile?.baseResume ?? baseVersion?.structuredResume ?? null);
    // Tailoring rewords the summary and work bullets (project bullets follow with the layout
    // work, #415): with none of either there is nothing to tailor.
    const tailorRequest = base ? buildTailorRequest(base, job, confirmedKeywords) : null;
    if (!base || !tailorRequest || editableLines(base).length === 0) {
      return response.status(409).json({
        code: 'BASE_RESUME_EMPTY',
        error: 'Add a summary or work experience with bullet points in Settings → Résumé before tailoring.',
      });
    }
    if (tailorRequest.lines.length === 0) {
      return response.status(409).json({
        code: 'RESUME_LINES_TOO_LONG',
        error:
          'Your summary and bullet points are too long to tailor (a bullet over 1,000 characters, a summary over 3,000). Shorten them in Settings → Résumé.',
      });
    }
    if (!job.descriptionText?.trim()) {
      return response.status(409).json({
        code: 'POSTING_EMPTY',
        error: 'This job has no posting text to tailor to. Add the job description first.',
      });
    }

    const answer = await resolveTailorResume(tailorRequest);
    // The agent refuses a posting that looks like a prompt injection (INJECTION_ACTION=refuse).
    // Trying again can't help, and each try is a paid call.
    if (isInjectionRefusal(answer)) {
      return response.status(422).json({
        code: 'POSTING_REFUSED',
        error: "This posting seems to contain instructions to the AI, so it wasn't tailored. Check the job description.",
      });
    }
    const result = tailorFromAnswer(base, answer, {
      company: job.company,
      jobTerms: postingKeywords(job),
      confirmedKeywords,
      sentPaths: tailorRequest.lines.map((line) => line.path),
    });
    // Nothing from the AI (the API's own additions of confirmed keywords don't count).
    if (result.suggested === 0) {
      throw new AiUnavailableError("The AI didn't suggest any changes. Try again.");
    }

    const now = new Date().toISOString();
    const version: ResumeVersionRecord = {
      id: randomUUID(),
      userId,
      jobId,
      changeSummary: result.changeSummary,
      changeDetails: result.details,
      structuredResume: result.resume,
      approved: false,
      isBase: false,
      basedOn: {
        baseVersionId: baseVersion?.id ?? null,
        baseUpdatedAt: baseVersion?.updatedAt ?? profile?.updatedAt ?? null,
        jobId,
        postingSha256: createHash('sha256').update(job.descriptionText).digest('hex'),
        model: answer.model_used,
        createdAt: now,
        grounding: { version: GROUNDING_VERSION },
        confirmedKeywords,
        gaps: result.gaps,
      },
      createdAt: now,
      updatedAt: now,
    };
    await insertResumeVersion(version);

    return response.status(201).json({ status: 'awaiting_approval', version });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs/:id/resume-versions
 *
 * Lists all tailored resume versions associated with a specific job.
 */
resumeStudioRouter.get('/jobs/:id/resume-versions', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id;
    const versions = await listResumeVersionsForJob(userId, jobId!);
    return response.json({ versions });
  } catch (error) {
    next(error);
  }
});

/** A tailored draft of this user's, or null. Base versions are not drafts. */
async function getDraft(userId: string, id: string): Promise<ResumeVersionRecord | null> {
  const version = await getResumeVersion(userId, id);
  return version && !version.isBase ? version : null;
}

/**
 * POST /api/resume-versions/:id/approve
 *
 * Approves a tailored draft the API checked (422 NOT_GROUNDED otherwise): renders the PDF,
 * stores it, and marks the version approved.
 */
resumeStudioRouter.post('/resume-versions/:id/approve', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getDraft(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }
    if (!isGrounded(version)) {
      return response.status(422).json(NOT_GROUNDED);
    }

    const pdfBuffer = renderAtsResumePdf(version.structuredResume);
    const { fileUrl } = await storeResumePdf(version, pdfBuffer);
    const updated = await updateResumeVersion(userId, id!, {
      approved: true,
      tailoredResumeFileUrl: fileUrl,
    });

    return response.json({
      version: updated,
      fileUrl,
      approved: true,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/resume-versions/:id/reject
 *
 * Rejects a tailored draft version with optional feedback:
 * Sets approved = false and records user feedback notes in changeSummary.
 */
resumeStudioRouter.post('/resume-versions/:id/reject', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getDraft(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }

    const body = (request.body ?? {}) as { feedback?: string };
    const feedback = body.feedback?.trim();
    const updatedSummary = feedback
      ? `${version.changeSummary} [Rejected with feedback: ${feedback}]`
      : `${version.changeSummary} [Rejected]`;

    const updated = await updateResumeVersion(userId, id!, {
      approved: false,
      changeSummary: updatedSummary,
    });

    return response.json({
      version: updated,
      approved: false,
      feedback: feedback || null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/resume-versions/:id/download
 *
 * The PDF of an approved tailored draft the API checked: 422 NOT_GROUNDED for a draft it
 * didn't check, 409 NOT_APPROVED before approval.
 */
resumeStudioRouter.get('/resume-versions/:id/download', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getDraft(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }
    if (!isGrounded(version)) {
      return response.status(422).json(NOT_GROUNDED);
    }
    if (!version.approved) {
      return response.status(409).json({ code: 'NOT_APPROVED', error: 'Approve this draft before downloading it.' });
    }

    const pdfBuffer = renderAtsResumePdf(version.structuredResume);
    const candidateName = version.structuredResume.basics?.name || 'Resume';

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      attachmentDisposition(`${candidateName.replace(/\s+/g, '_')}_${version.id}.pdf`),
    );
    return response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});
