'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, updateJob } from '@/lib/api';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '@/lib/format';
import type { Job } from '@/types/job';

const statusOptions: Job['status'][] = [
  'discovered',
  'shortlisted',
  'applied',
  'outreach_drafted',
  'outreach_sent',
  'referral_requested',
  'follow_up_due',
  'interview',
  'rejected',
  'offer',
  'archived',
];

const priorityOptions: Job['priority'][] = ['high', 'medium', 'low'];

type FormState = {
  status: Job['status'];
  priority: Job['priority'];
  notes: string;
  nextAction: string;
  nextActionDue: string;
};

export function JobEditPanel({ job }: { job: Job }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    status: job.status,
    priority: job.priority,
    notes: job.notes ?? '',
    nextAction: job.nextAction ?? '',
    nextActionDue: toDatetimeLocalValue(job.nextActionDue),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validate(values: FormState) {
    const nextErrors: Record<string, string> = {};

    if (values.nextActionDue.trim()) {
      const parsed = Date.parse(values.nextActionDue);
      if (Number.isNaN(parsed)) {
        nextErrors.nextActionDue = 'Please enter a valid follow-up date and time.';
      }
    }

    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSaving(true);

    try {
      await updateJob(job.id, {
        status: form.status,
        priority: form.priority,
        notes: form.notes.trim() || undefined,
        nextAction: form.nextAction.trim() || undefined,
        nextActionDue: form.nextActionDue.trim() ? fromDatetimeLocalValue(form.nextActionDue) : undefined,
      });

      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields ?? { form: error.message });
      } else {
        setErrors({ form: error instanceof Error ? error.message : 'Failed to update the job.' });
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div className="detail-card">
        <p className="detail-card__title">Job status</p>
        <p className="detail-card__value">
          Keep the CRM state current and use this panel to move the job through the pipeline.
        </p>
      </div>

      {errors.form ? (
        <div className="callout callout--accent">
          <p className="callout__title">Could not save changes</p>
          <p className="callout__text">{errors.form}</p>
        </div>
      ) : null}

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field__label">Status</span>
          <select
            className="field__input"
            value={form.status}
            onChange={(event) => updateField('status', event.target.value as Job['status'])}
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Priority</span>
          <select
            className="field__input"
            value={form.priority}
            onChange={(event) => updateField('priority', event.target.value as Job['priority'])}
          >
            {priorityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea
          className="field__textarea"
          value={form.notes}
          onChange={(event) => updateField('notes', event.target.value)}
          placeholder="Add context, comp notes, or follow-up reminders."
        />
      </label>

      <label className="field">
        <span className="field__label">Next action</span>
        <textarea
          className="field__textarea field__textarea--small"
          value={form.nextAction}
          onChange={(event) => updateField('nextAction', event.target.value)}
          placeholder="Example: Send follow-up after resume review."
        />
      </label>

      <label className="field">
        <span className="field__label">Follow-up due</span>
        <input
          className="field__input"
          type="datetime-local"
          value={form.nextActionDue}
          onChange={(event) => updateField('nextActionDue', event.target.value)}
        />
        {errors.nextActionDue ? <span className="field-error">{errors.nextActionDue}</span> : null}
      </label>

      <div className="hero__actions">
        <button className="button button--primary" type="submit" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save changes'}
        </button>
        <a className="button button--ghost" href="#analysis">
          Open AI analysis
        </a>
      </div>
    </form>
  );
}
