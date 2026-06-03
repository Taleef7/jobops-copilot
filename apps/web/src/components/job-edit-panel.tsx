'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const selectClass =
  'border-input bg-card h-9 w-full rounded-md border px-2.5 text-sm capitalize shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none';

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
  const [dateError, setDateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
        notes: form.notes.trim() || undefined,
        nextAction: form.nextAction.trim() || undefined,
        nextActionDue: form.nextActionDue.trim()
          ? fromDatetimeLocalValue(form.nextActionDue)
          : undefined,
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
          <select
            id="job-status"
            className={selectClass}
            value={form.status}
            onChange={(event) => updateField('status', event.target.value as Job['status'])}
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="job-priority">Priority</Label>
          <select
            id="job-priority"
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
        <input
          id="job-followup"
          type="datetime-local"
          className={selectClass}
          value={form.nextActionDue}
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
