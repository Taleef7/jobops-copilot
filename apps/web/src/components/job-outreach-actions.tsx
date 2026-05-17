'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, draftOutreach } from '@/lib/api';
import type { OutreachMessageType } from '@/types/job';

const messageTypeOptions: { label: string; value: OutreachMessageType }[] = [
  { label: 'Recruiter email', value: 'recruiter_email' },
  { label: 'LinkedIn connection', value: 'linkedin_connection' },
  { label: 'Referral request', value: 'referral_request' },
  { label: 'Follow-up', value: 'follow_up' },
  { label: 'Thank you', value: 'thank_you' },
];

type FormState = {
  messageType: OutreachMessageType;
  contactName: string;
  contactRole: string;
  contactEmail: string;
};

type JobOutreachActionsProps = {
  jobId: string;
  jobContext: string;
  resumeSummary: string;
  disabled?: boolean;
};

export function JobOutreachActions({
  jobId,
  jobContext,
  resumeSummary,
  disabled = false,
}: JobOutreachActionsProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    messageType: 'recruiter_email',
    contactName: '',
    contactRole: '',
    contactEmail: '',
  });
  const [result, setResult] = useState<{
    subject: string;
    draftText: string;
    safetyNotes: string;
    gmailDraftStatus: 'created' | 'skipped' | 'failed';
    gmailDraftMessage: string;
    gmailDraftId: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    setError(null);
    setResult(null);
    setIsSubmitting(true);

    try {
      const draft = await draftOutreach({
        jobId,
        messageType: form.messageType,
        contactName: form.contactName.trim() || undefined,
        contactRole: form.contactRole.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        jobContext,
        resumeSummary,
      });

      setResult({
        subject: draft.subject,
        draftText: draft.draft_text,
        safetyNotes: draft.safety_notes,
        gmailDraftStatus: draft.gmail_draft_status,
        gmailDraftMessage: draft.gmail_draft_message,
        gmailDraftId: draft.gmail_draft_id,
      });
      router.refresh();
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Failed to draft outreach.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="detail-card">
        <p className="detail-card__title">Generate a draft</p>
        <p className="detail-card__value">
          The AI uses the current job description and demo resume snapshot, then stores the result
          as a human-reviewed outreach draft.
        </p>
      </div>

      {disabled ? (
        <div className="callout callout--accent">
          <p className="callout__title">API unavailable</p>
          <p className="callout__text">
            The inbox is showing seed data right now, so draft generation is disabled until the live
            API is available.
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="callout">
          <p className="callout__title">Draft created</p>
          <p className="callout__text">
            Subject: {result.subject}
            <br />
            {result.safetyNotes}
            <br />
            Gmail draft: {result.gmailDraftStatus}
            {result.gmailDraftMessage ? ` - ${result.gmailDraftMessage}` : ''}
            {result.gmailDraftId ? ` (id: ${result.gmailDraftId})` : ''}
            <br />
          </p>
          <p className="detail-card__value" style={{ whiteSpace: 'pre-wrap' }}>
            {result.draftText}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="callout callout--accent">
          <p className="callout__title">Could not draft outreach</p>
          <p className="callout__text">{error}</p>
        </div>
      ) : null}

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field__label">Message type</span>
          <select
            className="field__input"
            value={form.messageType}
            onChange={(event) => updateField('messageType', event.target.value as OutreachMessageType)}
            disabled={disabled || isSubmitting}
          >
            {messageTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Contact name</span>
          <input
            className="field__input"
            value={form.contactName}
            onChange={(event) => updateField('contactName', event.target.value)}
            placeholder="Optional"
            disabled={disabled || isSubmitting}
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Contact email</span>
        <input
          className="field__input"
          type="email"
          value={form.contactEmail}
          onChange={(event) => updateField('contactEmail', event.target.value)}
          placeholder="Optional, used for Gmail draft creation when enabled"
          disabled={disabled || isSubmitting}
        />
      </label>

      <label className="field">
        <span className="field__label">Contact role</span>
        <input
          className="field__input"
          value={form.contactRole}
          onChange={(event) => updateField('contactRole', event.target.value)}
          placeholder="Recruiter, hiring manager, referral partner, and so on"
          disabled={disabled || isSubmitting}
        />
      </label>

      <div className="hero__actions">
        <button className="button button--primary" type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? 'Drafting...' : 'Generate outreach'}
        </button>
        <a className="button button--ghost" href="/outreach">
          Open inbox
        </a>
      </div>
    </form>
  );
}
