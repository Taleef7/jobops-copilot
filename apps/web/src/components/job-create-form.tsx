'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, createJob } from '@/lib/api';
import type { Job } from '@/types/job';

const workplaceTypeOptions: Array<Job['workplaceType']> = ['remote', 'hybrid', 'onsite', 'flexible'];
const priorityOptions: Array<Job['priority']> = ['high', 'medium', 'low'];

type FormState = {
  company: string;
  title: string;
  jobUrl: string;
  source: string;
  location: string;
  employmentType: string;
  workplaceType: Job['workplaceType'];
  priority: Job['priority'];
  notes: string;
  descriptionText: string;
};

const initialState: FormState = {
  company: '',
  title: '',
  jobUrl: '',
  source: 'manual',
  location: 'Remote',
  employmentType: 'Full-time',
  workplaceType: 'remote',
  priority: 'medium',
  notes: '',
  descriptionText: '',
};

export function JobCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validate(values: FormState) {
    const nextErrors: Record<string, string> = {};

    if (!values.company.trim()) {
      nextErrors.company = 'Company is required.';
    }
    if (!values.title.trim()) {
      nextErrors.title = 'Job title is required.';
    }
    if (!values.descriptionText.trim()) {
      nextErrors.descriptionText = 'Job description is required.';
    }
    if (values.jobUrl.trim()) {
      try {
        void new URL(values.jobUrl.trim());
      } catch {
        nextErrors.jobUrl = 'Enter a valid job URL.';
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

    setIsSubmitting(true);

    try {
      const job = await createJob({
        company: form.company.trim(),
        title: form.title.trim(),
        jobUrl: form.jobUrl.trim() || undefined,
        source: form.source.trim() || undefined,
        location: form.location.trim() || undefined,
        employmentType: form.employmentType.trim() || undefined,
        workplaceType: form.workplaceType,
        priority: form.priority,
        notes: form.notes.trim() || undefined,
        descriptionText: form.descriptionText.trim(),
      });

      router.push(`/jobs/${job.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields ?? { form: error.message });
      } else {
        setErrors({ form: error instanceof Error ? error.message : 'Failed to create the job.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      {errors.form ? (
        <div className="callout callout--accent">
          <p className="callout__title">Could not save job</p>
          <p className="callout__text">{errors.form}</p>
        </div>
      ) : null}

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field__label">Company</span>
          <input
            className="field__input"
            value={form.company}
            onChange={(event) => updateField('company', event.target.value)}
            placeholder="Northwind Labs"
            required
          />
          {errors.company ? <span className="field-error">{errors.company}</span> : null}
        </label>

        <label className="field">
          <span className="field__label">Job title</span>
          <input
            className="field__input"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="AI Automation Engineer"
            required
          />
          {errors.title ? <span className="field-error">{errors.title}</span> : null}
        </label>
      </div>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field__label">Job URL</span>
          <input
            className="field__input"
            value={form.jobUrl}
            onChange={(event) => updateField('jobUrl', event.target.value)}
            placeholder="https://careers.example.com/jobs/ai-automation-engineer"
          />
          {errors.jobUrl ? <span className="field-error">{errors.jobUrl}</span> : null}
        </label>

        <label className="field">
          <span className="field__label">Source</span>
          <input
            className="field__input"
            value={form.source}
            onChange={(event) => updateField('source', event.target.value)}
            placeholder="manual"
          />
        </label>
      </div>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field__label">Location</span>
          <input
            className="field__input"
            value={form.location}
            onChange={(event) => updateField('location', event.target.value)}
            placeholder="Remote"
          />
        </label>

        <label className="field">
          <span className="field__label">Employment type</span>
          <input
            className="field__input"
            value={form.employmentType}
            onChange={(event) => updateField('employmentType', event.target.value)}
            placeholder="Full-time"
          />
        </label>
      </div>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field__label">Workplace type</span>
          <select
            className="field__input"
            value={form.workplaceType}
            onChange={(event) =>
              updateField('workplaceType', event.target.value as Job['workplaceType'])
            }
          >
            {workplaceTypeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
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
        <span className="field__label">Description</span>
        <textarea
          className="field__textarea"
          value={form.descriptionText}
          onChange={(event) => updateField('descriptionText', event.target.value)}
          placeholder="Paste the full job description here."
          required
        />
        {errors.descriptionText ? <span className="field-error">{errors.descriptionText}</span> : null}
      </label>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea
          className="field__textarea field__textarea--small"
          value={form.notes}
          onChange={(event) => updateField('notes', event.target.value)}
          placeholder="Optional internal notes."
        />
      </label>

      <div className="hero__actions">
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save job'}
        </button>
        <button className="button button--ghost" type="button" disabled>
          AI analysis starts after save
        </button>
      </div>
    </form>
  );
}
