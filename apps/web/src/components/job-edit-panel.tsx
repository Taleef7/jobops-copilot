'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionSelect } from '@/components/ui/option-select';
import { Textarea } from '@/components/ui/textarea';
import { useHydrated } from '@/hooks/use-hydrated';
import { ApiRequestError, updateJob } from '@/lib/api';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '@/lib/format';
import type { Job } from '@/types/job';

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** `outreach_drafted` -> `Outreach drafted`. */
function formatStatus(status: Job['status']) {
  return capitalise(status.replaceAll('_', ' '));
}

const statusOptions = (
  [
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
  ] as const satisfies readonly Job['status'][]
).map((value) => ({ value, label: formatStatus(value) }));

const priorityOptions = (['high', 'medium', 'low'] as const satisfies readonly Job['priority'][]).map(
  (value) => ({ value, label: capitalise(value) }),
);

type FormState = {
  status: Job['status'];
  priority: Job['priority'];
  notes: string;
  nextAction: string;
  nextActionDue: string;
};

export function JobEditPanel({ job }: { job: Job }) {
  const router = useRouter();
  const [initial] = useState<FormState>(() => ({
    status: job.status,
    priority: job.priority,
    notes: job.notes ?? '',
    nextAction: job.nextAction ?? '',
    nextActionDue: toDatetimeLocalValue(job.nextActionDue),
  }));
  const [form, setForm] = useState<FormState>(initial);
  const [dateError, setDateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // The follow-up is in the browser's time zone, so it's shown after hydration: the server's
  // (UTC) would show another time until then (#412).
  const hydrated = useHydrated();

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDateError(null);

    if (form.nextActionDue.trim() && Number.isNaN(Date.parse(form.nextActionDue))) {
      setDateError('Please enter a valid follow-up date and time.');
      return;
    }

    setIsSaving(true);
    try {
      await updateJob(job.id, {
        status: form.status,
        priority: form.priority,
        // A field left out is unchanged, so a cleared one is sent as null.
        notes: form.notes.trim() || null,
        nextAction: form.nextAction.trim() || null,
        // Only when changed: when the clocks go back, an hour repeats and the input can't say
        // which, so reading it back could move the due date an hour.
        nextActionDue:
          form.nextActionDue === initial.nextActionDue
            ? undefined
            : form.nextActionDue.trim()
              ? fromDatetimeLocalValue(form.nextActionDue)
              : null,
      });
      toast.success('Job updated.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Failed to update the job.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="job-status">Status</Label>
          <OptionSelect
            id="job-status"
            value={form.status}
            onValueChange={(value) => updateField('status', value)}
            options={statusOptions}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="job-priority">Priority</Label>
          <OptionSelect
            id="job-priority"
            value={form.priority}
            onValueChange={(value) => updateField('priority', value)}
            options={priorityOptions}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="job-notes">Notes</Label>
        <Textarea
          id="job-notes"
          value={form.notes}
          onChange={(event) => updateField('notes', event.target.value)}
          placeholder="Add context, comp notes, or reminders."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="job-next-action">Next action</Label>
        <Textarea
          id="job-next-action"
          className="min-h-16"
          value={form.nextAction}
          onChange={(event) => updateField('nextAction', event.target.value)}
          placeholder="e.g. Send follow-up after resume review."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="job-followup">Follow-up due</Label>
        <Input
          id="job-followup"
          type="datetime-local"
          value={hydrated ? form.nextActionDue : ''}
          onChange={(event) => updateField('nextActionDue', event.target.value)}
        />
        {dateError ? <p className="text-destructive text-xs">{dateError}</p> : null}
      </div>

      <Button type="submit" disabled={isSaving} className="w-full">
        {isSaving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
