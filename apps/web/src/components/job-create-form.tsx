'use client';

import { Download, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError, createJob, extractJobFromUrl } from '@/lib/api';
import type { Job } from '@/types/job';

const workplaceTypeOptions: Array<Job['workplaceType']> = ['remote', 'hybrid', 'onsite', 'flexible'];
const priorityOptions: Array<Job['priority']> = ['high', 'medium', 'low'];

const selectClass =
  'border-input bg-card h-9 w-full rounded-md border px-2.5 text-sm capitalize shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

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
  const [isExtracting, setIsExtracting] = useState(false);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleAutofill() {
    const url = form.jobUrl.trim();
    if (!isHttpUrl(url)) return;
    setIsExtracting(true);
    setAutofillNote(null);
    try {
      const data = await extractJobFromUrl(url);
      const hasAny = Boolean(
        data.title || data.company || data.location || data.descriptionText || data.workplaceType,
      );
      if (!hasAny) {
        setAutofillNote('Couldn’t read that posting automatically — paste the description below.');
        return;
      }
      setForm((current) => ({
        ...current,
        title: data.title ?? current.title,
        company: data.company ?? current.company,
        location: data.location ?? current.location,
        descriptionText: data.descriptionText ?? current.descriptionText,
        workplaceType: data.workplaceType ?? current.workplaceType,
      }));
      setErrors({});
      const label = data.source === 'jsonld' ? 'the posting’s structured data' : 'page metadata';
      toast.success(`Autofilled from ${label} — review before saving.`);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not read that job posting.',
      );
    } finally {
      setIsExtracting(false);
    }
  }

  function validate(values: FormState) {
    const nextErrors: Record<string, string> = {};
    if (!values.company.trim()) nextErrors.company = 'Company is required.';
    if (!values.title.trim()) nextErrors.title = 'Job title is required.';
    if (!values.descriptionText.trim()) nextErrors.descriptionText = 'Job description is required.';
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
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

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
      toast.success('Job saved.');
      router.push(`/jobs/${job.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields ?? {});
        toast.error(error.message);
      } else {
        toast.error(error instanceof Error ? error.message : 'Failed to create the job.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="description">Job description</Label>
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Sparkles className="size-3.5 text-indigo-500" /> AI extracts skills &amp; scores fit
          </span>
        </div>
        {/* Cap the height so a long paste scrolls internally instead of pushing the
            rest of the form off-screen (the Textarea uses field-sizing-content). */}
        <Textarea
          id="description"
          value={form.descriptionText}
          onChange={(event) => updateField('descriptionText', event.target.value)}
          placeholder="Paste the full job posting here…"
          className="max-h-80 min-h-40 overflow-y-auto"
          required
        />
        {errors.descriptionText ? (
          <p className="text-destructive text-xs">{errors.descriptionText}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            value={form.company}
            onChange={(event) => updateField('company', event.target.value)}
            placeholder="Pebble"
            required
          />
          {errors.company ? <p className="text-destructive text-xs">{errors.company}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="title">Job title</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="AI Software Engineer"
            required
          />
          {errors.title ? <p className="text-destructive text-xs">{errors.title}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="jobUrl">Job URL</Label>
          <div className="flex gap-2">
            <Input
              id="jobUrl"
              value={form.jobUrl}
              onChange={(event) => updateField('jobUrl', event.target.value)}
              placeholder="https://…"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleAutofill}
              disabled={!isHttpUrl(form.jobUrl) || isExtracting}
              className="shrink-0 gap-1.5"
            >
              {isExtracting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              Autofill
            </Button>
          </div>
          {errors.jobUrl ? <p className="text-destructive text-xs">{errors.jobUrl}</p> : null}
          {/* Always-present live region so a screen reader announces a failed autofill. */}
          <p role="status" className="text-muted-foreground text-xs empty:hidden">
            {autofillNote ?? ''}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={form.location}
            onChange={(event) => updateField('location', event.target.value)}
            placeholder="Remote · San Francisco"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workplace">Workplace</Label>
          <select
            id="workplace"
            className={selectClass}
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
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            className={selectClass}
            value={form.priority}
            onChange={(event) => updateField('priority', event.target.value as Job['priority'])}
          >
            {priorityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting} className="gap-1.5">
          <Sparkles className="size-4" />
          {isSubmitting ? 'Saving…' : 'Save & analyze'}
        </Button>
      </div>
    </form>
  );
}
