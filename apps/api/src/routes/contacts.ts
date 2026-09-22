import { Router } from 'express';
import {
  deleteJobContact,
  getJobContactById,
  insertJobContact,
  listJobContacts,
  normalizeEvidence,
  updateJobContact,
} from '@/data/contact-store';
import { getJobById } from '@/data/job-store';
import { requireUser } from '@/lib/auth';
import type { JobContactStatus } from '@/types';

export const contactsRouter = Router();

const VALID_STATUSES = new Set<JobContactStatus>([
  'found',
  'outreach_drafted',
  'contacted',
  'replied',
  'archived',
]);

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

  if (!Array.isArray(evidence)) {
    return response.status(400).json({ error: 'evidence must be an array of URLs or evidence objects' });
  }

  const normalizedEvidence = normalizeEvidence(evidence);
  if (normalizedEvidence.length === 0) {
    return response.status(400).json({
      error: 'Every contact must carry at least 1 public evidence URL',
    });
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
      evidence: normalizedEvidence,
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

  if (evidence !== undefined) {
    if (!Array.isArray(evidence)) {
      return response.status(400).json({ error: 'evidence must be an array of URLs or evidence objects' });
    }
    const normalized = normalizeEvidence(evidence);
    if (normalized.length === 0) {
      return response.status(400).json({
        error: 'Every contact must carry at least 1 public evidence URL',
      });
    }
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
