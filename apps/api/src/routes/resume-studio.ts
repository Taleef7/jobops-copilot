import { randomUUID } from 'node:crypto';
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
import { renderAtsResumePdf } from '@/lib/ats-resume-pdf';
import { requireUser } from '@/lib/auth';
import { storeResumePdf } from '@/lib/resume-storage';
import type { ResumeVersionRecord, StructuredResume } from '@/types';

export const resumeStudioRouter = Router();

/**
 * POST /api/jobs/:id/tailor
 *
 * Initiates an interactive tailoring run for a specific job.
 * Loads the user's base resume and the target job details, then initiates
 * the resume-tailor agent run or creates a deterministic draft version.
 */
resumeStudioRouter.post('/jobs/:id/tailor', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id;
    const job = await getJobById(userId, jobId!);
    if (!job) {
      return response.status(404).json({ error: `Job not found: ${jobId}` });
    }

    // Load base resume (profile or version store)
    let baseResume: StructuredResume | null = null;
    const baseVersion = await getBaseResumeVersion(userId);
    if (baseVersion) {
      baseResume = baseVersion.structuredResume;
    } else {
      const profile = await getUserProfile(userId);
      baseResume = profile?.baseResume ?? null;
    }

    if (!baseResume || !baseResume.basics?.name) {
      return response.status(400).json({
        error: 'No structured base resume configured. Please set up your base resume in Settings first.',
      });
    }

    const versionId = randomUUID();

    // Create initial draft row in resume_versions with approved = false
    const draftVersion: ResumeVersionRecord = {
      id: versionId,
      userId,
      jobId,
      changeSummary: `Tailored resume draft for ${job.title} at ${job.company}`,
      changeDetails: [
        {
          section: 'basics.summary',
          oldText: baseResume.basics.summary,
          newText: `Experienced professional tailored for ${job.title} at ${job.company}: ${baseResume.basics.summary}`,
          rationale: `Targeted summary directly aligning with ${job.title} core qualifications.`,
        },
      ],
      structuredResume: {
        ...baseResume,
        basics: {
          ...baseResume.basics,
          summary: `Experienced professional tailored for ${job.title} at ${job.company}: ${baseResume.basics.summary}`,
        },
      },
      approved: false,
      isBase: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await insertResumeVersion(draftVersion);

    return response.status(201).json({
      status: 'awaiting_approval',
      version: draftVersion,
      threadId: `${userId}:resume-tailor:${jobId}`,
    });
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

/**
 * POST /api/resume-versions/:id/approve
 *
 * Approves a tailored draft version:
 * 1. Sets approved = true
 * 2. Renders deterministic ATS-safe PDF
 * 3. Persists to blob storage (or local fallback)
 * 4. Updates version record with tailoredResumeFileUrl
 */
resumeStudioRouter.post('/resume-versions/:id/approve', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getResumeVersion(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }

    // Render ATS PDF
    const pdfBuffer = renderAtsResumePdf(version.structuredResume);

    // Upload / persist to blob storage
    const { fileUrl } = await storeResumePdf(version, pdfBuffer);

    // Update row: approved = true, tailoredResumeFileUrl = fileUrl
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
    const version = await getResumeVersion(userId, id!);
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
 * Gated download endpoint for a specific resume version.
 * Requires user authentication; returns short-lived SAS URL or streams PDF binary.
 */
resumeStudioRouter.get('/resume-versions/:id/download', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getResumeVersion(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }

    const pdfBuffer = renderAtsResumePdf(version.structuredResume);
    const candidateName = version.structuredResume.basics?.name || 'Resume';

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${candidateName.replace(/\s+/g, '_')}_${version.id}.pdf"`,
    );
    return response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});
