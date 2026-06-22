'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError, draftOutreach } from '@/lib/api';
import type { OutreachMessageType } from '@/types/job';

const messageTypeOptions: { label: string; value: OutreachMessageType }[] = [
  { label: 'Recruiter email', value: 'recruiter_email' },
  { label: 'LinkedIn connection', value: 'linkedin_connection' },
  { label: 'Referral request', value: 'referral_request' },
  { label: 'Follow-up', value: 'follow_up' },
  { label: 'Thank you', value: 'thank_you' },
];

const selectClass =
  'border-input bg-card h-9 w-full rounded-md border px-2.5 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none disabled:opacity-50';

type FormState = {
  messageType: OutreachMessageType;
  contactName: string;
  contactRole: string;
  contactEmail: string;
};

type Result = {
  subject: string;
  draftText: string;
  safetyNotes: string;
  gmailDraftStatus: 'created' | 'skipped' | 'failed';
};

export function JobOutreachActions({
  jobId,
  jobContext,
  disabled = false,
}: {
  jobId: string;
  jobContext: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    messageType: 'recruiter_email',
    contactName: '',
    contactRole: '',
    contactEmail: '',
  });
  const [result, setResult] = useState<Result | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
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
      });
      setResult({
        subject: draft.subject,
        draftText: draft.draft_text,
        safetyNotes: draft.safety_notes,
        gmailDraftStatus: draft.gmail_draft_status,
      });
      toast.success('Draft created — review it in the inbox before sending.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Failed to draft outreach.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const busy = disabled || isSubmitting;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard.`);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-muted-foreground text-sm">
        The AI drafts from the job description and your resume snapshot, then stores a
        <span className="text-foreground font-medium"> human-reviewed draft</span> — nothing is sent.
      </p>

      {disabled ? (
        <Card className="border-amber-500/30 bg-amber-500/5 gap-1 p-3">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">API unavailable</p>
          <p className="text-muted-foreground text-sm">
            Draft generation is disabled while showing seed data.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="msg-type">Message type</Label>
          <select
            id="msg-type"
            className={selectClass}
            value={form.messageType}
            onChange={(event) =>
              updateField('messageType', event.target.value as OutreachMessageType)
            }
            disabled={busy}
          >
            {messageTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">Contact name</Label>
          <Input
            id="contact-name"
            value={form.contactName}
            onChange={(event) => updateField('contactName', event.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">Contact email</Label>
          <Input
            id="contact-email"
            type="email"
            value={form.contactEmail}
            onChange={(event) => updateField('contactEmail', event.target.value)}
            placeholder="Optional (for Gmail draft)"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-role">Contact role</Label>
          <Input
            id="contact-role"
            value={form.contactRole}
            onChange={(event) => updateField('contactRole', event.target.value)}
            placeholder="Recruiter, hiring manager…"
            disabled={busy}
          />
        </div>
      </div>

      <Button type="submit" disabled={busy} className="gap-1.5">
        {isSubmitting ? 'Drafting…' : 'Generate outreach'}
      </Button>

      {result ? (
        <Card className="gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{result.subject}</p>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Gmail: {result.gmailDraftStatus}</Badge>
              {form.contactEmail.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(form.contactEmail.trim(), 'Email address')}
                >
                  <Copy className="size-3.5" /> Email
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy(`Subject: ${result.subject}\n\n${result.draftText}`, 'Draft')}
              >
                <Copy className="size-3.5" /> Copy draft
              </Button>
            </div>
          </div>
          <p className="text-sm whitespace-pre-wrap">{result.draftText}</p>
          {result.safetyNotes.trim() ? (
            <details className="border-t pt-2">
              <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                Review notes
              </summary>
              <p className="text-muted-foreground mt-1.5 text-xs whitespace-pre-wrap">
                {result.safetyNotes}
              </p>
            </details>
          ) : null}
        </Card>
      ) : null}
    </form>
  );
}
