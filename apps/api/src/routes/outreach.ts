import { Router } from 'express';
import { updateOutreachDraft } from '@/data/job-store';
import { requireUser } from '@/lib/auth';
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
