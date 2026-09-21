import { Router } from 'express';
import { getOutreachDraft, updateOutreachDraft } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion } from '@/data/resume-version-store';
import { requireUser } from '@/lib/auth';
import { renderCoverLetterPdf } from '@/lib/cover-letter-pdf';
import type { OutreachStatus } from '@/types';

export const outreachRouter = Router();

export const allowedStatuses = new Set<OutreachStatus>(['drafted', 'approved', 'sent', 'skipped']);

type OutreachUpdateInput = {
  status?: unknown;
  gmailDraftId?: unknown;
  sentAt?: unknown;
  followUpDue?: unknown;
};

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function normalizeOutreachUpdateBody(body: OutreachUpdateInput) {
  return {
    status: normalizeOptionalText(body.status),
    gmailDraftId: normalizeOptionalText(body.gmailDraftId),
    sentAt: normalizeOptionalText(body.sentAt),
    followUpDue: normalizeOptionalText(body.followUpDue),
  };
}

export function validateOutreachUpdateBody(body: OutreachUpdateInput) {
  const normalized = normalizeOutreachUpdateBody(body);
  const errors: Record<string, string> = {};

  if (typeof body.status !== 'undefined' && (!normalized.status || !allowedStatuses.has(normalized.status as OutreachStatus))) {
    errors.status = 'Invalid outreach status.';
  }
  if (normalized.sentAt && Number.isNaN(Date.parse(normalized.sentAt))) {
    errors.sentAt = 'sentAt must be a valid date.';
  }
  if (normalized.followUpDue && Number.isNaN(Date.parse(normalized.followUpDue))) {
    errors.followUpDue = 'followUpDue must be a valid date.';
  }

  return {
    normalized,
    errors,
  };
}

outreachRouter.patch('/:id', async (request, response, next) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body as OutreachUpdateInput;
  const { errors, normalized } = validateOutreachUpdateBody(body);

  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Invalid outreach update payload', fields: errors });
    return;
  }

  try {
    const outreach = await updateOutreachDraft(userId, request.params.id, {
      status: normalized.status as OutreachStatus | undefined,
      gmailDraftId: normalized.gmailDraftId,
      sentAt: normalized.sentAt,
      followUpDue: normalized.followUpDue,
    });

    if (!outreach) {
      response.status(404).json({ error: 'Outreach draft not found' });
      return;
    }

    response.json({ outreach });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/outreach/:id
 *
 * Retrieves a specific outreach draft and its associated job details.
 */
outreachRouter.get('/:id', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const result = await getOutreachDraft(userId, request.params.id);
    if (!result) {
      return response.status(404).json({ error: 'Outreach draft not found' });
    }

    return response.json({ draft: result.draft, job: result.job });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/outreach/:id/download-pdf
 *
 * Renders a cover letter draft into an ATS-compliant PDF and streams it.
 */
outreachRouter.get('/:id/download-pdf', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const result = await getOutreachDraft(userId, request.params.id);
    if (!result) {
      return response.status(404).json({ error: 'Outreach draft not found' });
    }

    const { draft, job } = result;

    // Resolve candidate details from base resume or profile
    const baseVersion = await getBaseResumeVersion(userId);
    const profile = await getUserProfile(userId);
    const candidateBasics = baseVersion?.structuredResume?.basics || profile?.baseResume?.basics;

    const candidateName = candidateBasics?.name || 'Candidate';
    const candidateEmail = candidateBasics?.email;
    const candidatePhone = candidateBasics?.phone;
    const candidateLocation = candidateBasics?.location?.city
      ? [candidateBasics.location.city, candidateBasics.location.region].filter(Boolean).join(', ')
      : undefined;

    const pdfBuffer = renderCoverLetterPdf({
      candidateName,
      candidateEmail,
      candidatePhone,
      candidateLocation,
      recipientName: draft.contactName,
      recipientRole: draft.contactRole,
      companyName: job?.company,
      subject: job ? `${job.title} at ${job.company}` : undefined,
      bodyText: draft.draftText,
    });

    const safeCandidateName = candidateName.replace(/\s+/g, '_');
    const safeCompanyName = (job?.company || 'Company').replace(/\s+/g, '_');
    const filename = `Cover_Letter_${safeCandidateName}_${safeCompanyName}.pdf`;

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

