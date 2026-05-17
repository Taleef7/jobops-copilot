import { Router } from 'express';
import { updateOutreachDraft } from '@/data/job-store';
import type { OutreachStatus, UpdateOutreachBody } from '@/types';

export const outreachRouter = Router();

const allowedStatuses = new Set<OutreachStatus>(['drafted', 'approved', 'sent', 'skipped']);

outreachRouter.patch('/:id', async (request, response, next) => {
  const body = request.body as UpdateOutreachBody;
  const errors: Record<string, string> = {};

  if (body.status && !allowedStatuses.has(body.status)) {
    errors.status = 'Invalid outreach status.';
  }
  if (body.sentAt && Number.isNaN(Date.parse(body.sentAt))) {
    errors.sentAt = 'sentAt must be a valid date.';
  }
  if (body.followUpDue && Number.isNaN(Date.parse(body.followUpDue))) {
    errors.followUpDue = 'followUpDue must be a valid date.';
  }

  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Invalid outreach update payload', fields: errors });
    return;
  }

  try {
    const outreach = await updateOutreachDraft(request.params.id, {
      status: body.status,
      gmailDraftId: body.gmailDraftId?.trim() || undefined,
      sentAt: body.sentAt?.trim() || undefined,
      followUpDue: body.followUpDue?.trim() || undefined,
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
