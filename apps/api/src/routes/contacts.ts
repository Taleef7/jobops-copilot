import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  deleteJobContact,
  getJobContactById,
  insertJobContact,
  listJobContacts,
  normalizeEvidence,
  updateJobContact,
} from '@/data/contact-store';
import { appendOutreachDraft, getJobById } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion } from '@/data/resume-version-store';
import { AiUnavailableError, resolveOutreachDraft } from '@/lib/agent-client';
import { requireUser } from '@/lib/auth';
import { emitApprovalNeededNotification } from '@/lib/notify/events';
import type { JobContactStatus, OutreachDraft, StructuredResume } from '@/types';

export const contactsRouter = Router();

const VALID_STATUSES = new Set<JobContactStatus>([
  'found',
  'outreach_drafted',
  'contacted',
  'replied',
  'archived',
]);

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** The card labels `linkedinUrl` "LinkedIn", so it must be one. Other links are evidence. */
function isLinkedInUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

/**
 * A short, factual summary built only from the user's own structured résumé
 * (title, latest role, skills), for a résumé whose summary field is blank.
 */
export function summaryFromResume(resume: StructuredResume | null | undefined): string {
  if (!resume) return '';
  const parts: string[] = [];
  const label = resume.basics?.label?.trim();
  if (label) parts.push(`${label}.`);
  const latest = resume.work?.find((w) => w.position?.trim() && w.company?.trim());
  if (latest) parts.push(`Recent role: ${latest.position.trim()} at ${latest.company.trim()}.`);
  const skills = (resume.skills ?? [])
    .flatMap((group) => group.skills ?? [])
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (skills.length) parts.push(`Skills: ${skills.join(', ')}.`);
  return parts.join(' ');
}

/**
 * A contact's links are rendered as links, so only http(s) URLs are accepted.
 * Evidence is optional: a person the user knows needs none (#344).
 */
function linkError(evidence: unknown, linkedinUrl: unknown): string | null {
  if (evidence !== undefined) {
    if (!Array.isArray(evidence)) {
      return 'evidence must be an array of URLs or evidence objects';
    }
    const normalized = normalizeEvidence(evidence);
    if (normalized.length !== evidence.length || !normalized.every((item) => isHttpUrl(item.url))) {
      return 'Each evidence link must be an http(s) URL';
    }
  }
  if (typeof linkedinUrl === 'string' && linkedinUrl.trim()) {
    const url = linkedinUrl.trim();
    if (!isHttpUrl(url) || !isLinkedInUrl(url)) {
      return 'linkedinUrl must be a linkedin.com URL; save other links as evidence';
    }
  }
  return null;
}

// 1. List contacts for a job
contactsRouter.get('/jobs/:id/contacts', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const jobId = request.params.id;
  const job = await getJobById(userId, jobId);
  if (!job) {
    return response.status(404).json({ error: 'Job not found' });
  }

  try {
    const contacts = await listJobContacts(userId, jobId);
    return response.json({ contacts });
  } catch (error) {
    console.error('Error listing contacts:', error);
    return response.status(500).json({ error: 'Failed to list contacts' });
  }
});

// 2. Add contact for a job
contactsRouter.post('/jobs/:id/contacts', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const jobId = request.params.id;
  const job = await getJobById(userId, jobId);
  if (!job) {
    return response.status(404).json({ error: 'Job not found' });
  }

  const { name, roleTitle, evidence, relevance, email, linkedinUrl, status, notes } =
    request.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return response.status(400).json({ error: 'name is required and must be a non-empty string' });
  }

  if (!roleTitle || typeof roleTitle !== 'string' || !roleTitle.trim()) {
    return response.status(400).json({ error: 'roleTitle is required and must be a non-empty string' });
  }

  const createLinkError = linkError(evidence, linkedinUrl);
  if (createLinkError) {
    return response.status(400).json({ error: createLinkError });
  }

  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return response.status(400).json({
      error: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
    });
  }

  try {
    const created = await insertJobContact(userId, jobId, {
      name: name.trim(),
      roleTitle: roleTitle.trim(),
      evidence: evidence === undefined ? [] : normalizeEvidence(evidence),
      relevance: typeof relevance === 'string' ? relevance.trim() : undefined,
      email: typeof email === 'string' ? email.trim() : undefined,
      linkedinUrl: typeof linkedinUrl === 'string' ? linkedinUrl.trim() : undefined,
      status: status as JobContactStatus | undefined,
      notes: typeof notes === 'string' ? notes.trim() : undefined,
    });

    return response.status(201).json({ contact: created });
  } catch (error) {
    console.error('Error creating contact:', error);
    return response.status(500).json({ error: 'Failed to create contact' });
  }
});

// 3. Update contact status, notes, or details
contactsRouter.patch('/contacts/:id', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const contactId = request.params.id;
  const existing = await getJobContactById(userId, contactId);
  if (!existing) {
    return response.status(404).json({ error: 'Contact not found' });
  }

  const { name, roleTitle, evidence, relevance, email, linkedinUrl, status, notes } =
    request.body || {};

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return response.status(400).json({ error: 'name must be a non-empty string' });
  }

  if (roleTitle !== undefined && (typeof roleTitle !== 'string' || !roleTitle.trim())) {
    return response.status(400).json({ error: 'roleTitle must be a non-empty string' });
  }

  const updateLinkError = linkError(evidence, linkedinUrl);
  if (updateLinkError) {
    return response.status(400).json({ error: updateLinkError });
  }

  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return response.status(400).json({
      error: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
    });
  }

  try {
    const updated = await updateJobContact(userId, contactId, {
      name: typeof name === 'string' ? name.trim() : undefined,
      roleTitle: typeof roleTitle === 'string' ? roleTitle.trim() : undefined,
      evidence: evidence !== undefined ? normalizeEvidence(evidence) : undefined,
      relevance: relevance !== undefined ? (typeof relevance === 'string' ? relevance.trim() : null) : undefined,
      email: email !== undefined ? (typeof email === 'string' ? email.trim() : null) : undefined,
      linkedinUrl: linkedinUrl !== undefined ? (typeof linkedinUrl === 'string' ? linkedinUrl.trim() : null) : undefined,
      status: status as JobContactStatus | undefined,
      notes: notes !== undefined ? (typeof notes === 'string' ? notes.trim() : null) : undefined,
    });

    if (!updated) {
      return response.status(404).json({ error: 'Contact not found' });
    }

    return response.json({ contact: updated });
  } catch (error) {
    console.error('Error updating contact:', error);
    return response.status(500).json({ error: 'Failed to update contact' });
  }
});

// 4. Delete contact
contactsRouter.delete('/contacts/:id', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const contactId = request.params.id;
  try {
    const deleted = await deleteJobContact(userId, contactId);
    if (!deleted) {
      return response.status(404).json({ error: 'Contact not found' });
    }
    return response.json({ success: true });
  } catch (error) {
    console.error('Error deleting contact:', error);
    return response.status(500).json({ error: 'Failed to delete contact' });
  }
});

// 5. Draft personalized outreach for a specific contact
contactsRouter.post('/contacts/:id/draft-outreach', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const contactId = request.params.id;
  const contact = await getJobContactById(userId, contactId);
  if (!contact) {
    return response.status(404).json({ error: 'Contact not found' });
  }

  const job = await getJobById(userId, contact.jobId);
  if (!job) {
    return response.status(404).json({ error: 'Associated job not found' });
  }

  try {
    const baseVersion = await getBaseResumeVersion(userId);
    const profile = await getUserProfile(userId);
    const resume = baseVersion?.structuredResume || profile?.baseResume;
    // The draft is written from the user's own background, never an invented one.
    const candidateSummary =
      resume?.basics?.summary?.trim() ||
      summaryFromResume(resume) ||
      profile?.profileText?.trim() ||
      profile?.resumeText?.trim().slice(0, 1200);
    if (!candidateSummary) {
      return response.status(409).json({
        code: 'RESUME_REQUIRED',
        error: 'Add your résumé in Settings first, so the draft is written from your real background.',
      });
    }

    const draftResult = await resolveOutreachDraft({
      message_type: 'recruiter_email',
      contact_name: contact.name,
      contact_role: contact.roleTitle,
      company: job.company,
      job_context: `${job.title} at ${job.company}. ${job.descriptionText?.slice(0, 300) || ''}`,
      resume_summary: candidateSummary,
    });

    const draftId = randomUUID();
    const now = new Date().toISOString();
    const subject = draftResult.subject || `Inquiry regarding ${job.title} at ${job.company}`;
    const outreachDraft: OutreachDraft = {
      id: draftId,
      jobId: job.id,
      contactName: contact.name,
      contactRole: contact.roleTitle,
      email: contact.email || undefined,
      linkedinUrl: contact.linkedinUrl || undefined,
      messageType: 'recruiter_email',
      draftText: `Subject: ${subject}\n\n${draftResult.draft_text}`,
      status: 'drafted',
      createdAt: now,
    };

    // Store draft on the job record
    await appendOutreachDraft(userId, job.id, outreachDraft);

    await emitApprovalNeededNotification(userId, {
      kind: 'outreach',
      targetId: draftId,
      jobId: job.id,
      title: `Review Outreach Draft for ${contact.name}`,
      body: `Personalized outreach drafted for ${contact.name} (${contact.roleTitle}) at ${job.company}. Review and approve before sending.`,
    });

    // Transition contact status to outreach_drafted
    const updatedContact = await updateJobContact(userId, contact.id, {
      status: 'outreach_drafted',
      notes: contact.notes
        ? `${contact.notes}\nDrafted outreach: "${subject}"`
        : `Drafted outreach: "${subject}"`,
    });

    return response.status(200).json({
      contact: updatedContact,
      draft: outreachDraft,
    });
  } catch (error) {
    // The AI couldn't write the draft: 503 and retryable, and nothing was saved (#349).
    if (error instanceof AiUnavailableError) {
      return response.status(503).json({ error: error.message, retryable: true });
    }
    console.error('Error drafting outreach:', error);
    return response.status(500).json({ error: 'Failed to draft outreach' });
  }
});
