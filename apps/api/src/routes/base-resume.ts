import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getUserProfile, upsertUserProfile } from '@/data/profile-store';
import {
  getBaseResumeVersion,
  insertResumeVersion,
} from '@/data/resume-version-store';
import { resolveResumeParse } from '@/lib/agent-client';
import { requireUser } from '@/lib/auth';
import { enforceDailyBudget } from '@/lib/budget';
import { strictLimiter } from '@/lib/rate-limit';
import type { ResumeVersionRecord, StructuredResume } from '@/types';

export const baseResumeRouter = Router();

/**
 * GET /api/profile/base-resume
 *
 * Returns the user's canonical structured base resume.
 * Sources (in priority order):
 *   1. `user_profiles.base_resume` (fast, always consistent)
 *   2. The latest `resume_versions` row with `is_base = true` (fallback)
 *   3. `null` when no base resume exists yet
 */
baseResumeRouter.get('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const profile = await getUserProfile(userId);

    // Prefer the denormalized copy on the profile (faster, no version-store query).
    if (profile?.baseResume) {
      return response.json({ baseResume: profile.baseResume });
    }

    // Fallback: check resume_versions for an is_base row.
    const baseVersion = await getBaseResumeVersion(userId);
    if (baseVersion) {
      return response.json({ baseResume: baseVersion.structuredResume });
    }

    return response.json({ baseResume: null });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/profile/base-resume
 *
 * Save or update the canonical structured base resume.
 * Accepts a full `StructuredResume` in the request body.
 * Persists to both `user_profiles.base_resume` (denormalized) and
 * creates/updates a `resume_versions` row with `is_base = true`.
 */
baseResumeRouter.put('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { baseResume?: StructuredResume };

    if (!body.baseResume || !body.baseResume.basics || !body.baseResume.basics.name) {
      return response.status(400).json({
        error: 'baseResume with at least basics.name is required.',
      });
    }

    const baseResume = body.baseResume;

    // Persist to the denormalized profile column.
    await upsertUserProfile(userId, { baseResume });

    // Also create/update the base resume version row.
    const existingBase = await getBaseResumeVersion(userId);
    if (existingBase) {
      // Update the existing base version.
      const { updateResumeVersion } = await import('@/data/resume-version-store');
      await updateResumeVersion(userId, existingBase.id, {
        structuredResume: baseResume,
        changeSummary: 'Base resume updated via editor',
        approved: true,
      });
    } else {
      // Insert a new base version.
      const versionRecord: ResumeVersionRecord = {
        id: randomUUID(),
        userId,
        jobId: null,
        changeSummary: 'Initial base resume created',
        structuredResume: baseResume,
        approved: true,
        isBase: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await insertResumeVersion(versionRecord);
    }

    return response.json({ baseResume });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/parse-resume
 *
 * Parse the user's stored resume text into a StructuredResume.
 * Uses the AI agent when available, deterministic mock otherwise.
 *
 * Does NOT auto-save; the client should review the result and then
 * PUT /api/profile/base-resume to persist.
 *
 * Accepts an optional `resume_text` in the body; if absent, reads
 * the stored resume from the user's profile.
 */
baseResumeRouter.post(
  '/parse-resume',
  strictLimiter,
  enforceDailyBudget,
  async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { resume_text?: string };
    let resumeText = body.resume_text?.trim();

    // Fall back to the stored resume in the user's profile.
    if (!resumeText) {
      const profile = await getUserProfile(userId);
      resumeText = profile?.resumeText?.trim();
    }

    if (!resumeText) {
      return response.status(400).json({
        error: 'No resume text provided and no resume on file. Upload a resume first.',
      });
    }

    const structuredResume = await resolveResumeParse(resumeText);

    return response.json({ structuredResume });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/base-resume/render-pdf
 *
 * Renders an ATS-safe single-column PDF from the base resume (or submitted StructuredResume),
 * saves it to blob storage (with local fallback), updates the version record with fileUrl,
 * and returns the download/file URL.
 */
baseResumeRouter.post('/render-pdf', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = (request.body ?? {}) as { resume?: StructuredResume; versionId?: string };
    let resumeToRender = body.resume;
    let versionRecord: ResumeVersionRecord | null = null;

    if (body.versionId) {
      const { getResumeVersion } = await import('@/data/resume-version-store');
      versionRecord = await getResumeVersion(userId, body.versionId);
      if (versionRecord && !resumeToRender) {
        resumeToRender = versionRecord.structuredResume;
      }
    }

    if (!resumeToRender) {
      const baseVersion = await getBaseResumeVersion(userId);
      if (baseVersion) {
        versionRecord = baseVersion;
        resumeToRender = baseVersion.structuredResume;
      } else {
        const profile = await getUserProfile(userId);
        if (profile?.baseResume) {
          resumeToRender = profile.baseResume;
        }
      }
    }

    if (!resumeToRender || !resumeToRender.basics || !resumeToRender.basics.name) {
      return response.status(400).json({
        error: 'No valid structured resume found to render.',
      });
    }

    const { renderAtsResumePdf } = await import('@/lib/ats-resume-pdf');
    const pdfBuffer = renderAtsResumePdf(resumeToRender);

    if (!versionRecord) {
      versionRecord = {
        id: randomUUID(),
        userId,
        jobId: null,
        changeSummary: 'Base resume PDF render',
        structuredResume: resumeToRender,
        approved: true,
        isBase: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await insertResumeVersion(versionRecord);
    }

    const { storeResumePdf } = await import('@/lib/resume-storage');
    const { fileUrl } = await storeResumePdf(versionRecord, pdfBuffer);

    // Update version record with file URL
    const { updateResumeVersion } = await import('@/data/resume-version-store');
    await updateResumeVersion(userId, versionRecord.id, {
      baseResumeFileUrl: fileUrl,
    });

    return response.json({
      versionId: versionRecord.id,
      fileUrl,
      fileName: `resume_${versionRecord.id}.pdf`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile/base-resume/versions/:id/download
 *
 * Downloads the ATS-safe resume PDF for a specific version record.
 * Renders dynamically if no stored PDF exists.
 */
baseResumeRouter.get('/versions/:id/download', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const { getResumeVersion } = await import('@/data/resume-version-store');
    const version = await getResumeVersion(userId, id!);

    if (!version) {
      return response.status(404).json({ error: 'Resume version not found.' });
    }

    const { renderAtsResumePdf } = await import('@/lib/ats-resume-pdf');
    const pdfBuffer = renderAtsResumePdf(version.structuredResume);

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="resume_${version.basics?.name || 'document'}_${version.id}.pdf"`,
    );
    return response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

