'use client';

import { useState, type FormEvent } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusPill } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionSelect } from '@/components/ui/option-select';
import { Textarea } from '@/components/ui/textarea';
import {
  createJobContact,
  deleteContact,
  draftContactOutreach,
  updateContactStatus,
} from '@/lib/api';
import type { JobContactRecord, JobContactStatus } from '@/types/job';

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.63 1.63 0 0 0-1.63 1.63c0 .9.73 1.63 1.63 1.63.9 0 1.63-.73 1.63-1.63 0-.9-.73-1.63-1.63-1.63Z" />
    </svg>
  );
}

const STATUS_OPTIONS: { value: JobContactStatus; label: string }[] = [
  { value: 'found', label: 'Found' },
  { value: 'outreach_drafted', label: 'Outreach drafted' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
];

const EMPTY_FORM = { name: '', roleTitle: '', link: '', notes: '' };

/** Only a linkedin.com link is shown as "LinkedIn"; any other link is kept as a general link. */
function isLinkedInUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

interface JobContactsPanelProps {
  jobId: string;
  company: string;
  initialContacts?: JobContactRecord[];
}

export function JobContactsPanel({
  jobId,
  company,
  initialContacts = [],
}: JobContactsPanelProps) {
  const [contacts, setContacts] = useState<JobContactRecord[]>(initialContacts);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<{
    contactId: string;
    draftText: string;
  } | null>(null);

  function closeForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
  }

  async function handleAddContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const roleTitle = form.roleTitle.trim();
    if (!name || !roleTitle) return;
    const link = form.link.trim();
    const notes = form.notes.trim();

    setIsSaving(true);
    try {
      const created = await createJobContact(jobId, {
        name,
        roleTitle,
        ...(link ? (isLinkedInUrl(link) ? { linkedinUrl: link } : { evidence: [link] }) : {}),
        ...(notes ? { notes } : {}),
      });
      setContacts((prev) => [...prev, created]);
      closeForm();
      toast.success(`Added ${created.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add contact';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDraftOutreach(contact: JobContactRecord) {
    setDraftingId(contact.id);
    try {
      const res = await draftContactOutreach(contact.id);
      setContacts((prev) =>
        prev.map((c) => (c.id === contact.id ? res.contact : c)),
      );
      setActiveDraft({
        contactId: contact.id,
        draftText: res.draft.draftText,
      });
      toast.success(`Outreach drafted for ${contact.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to draft outreach';
      toast.error(msg);
    } finally {
      setDraftingId(null);
    }
  }

  async function handleStatusChange(contactId: string, nextStatus: JobContactStatus) {
    try {
      const updated = await updateContactStatus(contactId, nextStatus);
      setContacts((prev) => prev.map((c) => (c.id === contactId ? updated : c)));
      toast.success(`Status updated to ${nextStatus.replace('_', ' ')}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      toast.error(msg);
    }
  }

  async function handleDelete(contactId: string, name: string) {
    try {
      await deleteContact(contactId);
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
      if (activeDraft?.contactId === contactId) {
        setActiveDraft(null);
      }
      toast.success(`Contact ${name} removed`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete contact';
      toast.error(msg);
    }
  }

  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">People</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            People at {company} you know or found yourself. Drafts are never sent for you.
          </p>
        </div>
        {!showForm ? (
          <Button onClick={() => setShowForm(true)} className="gap-2 shrink-0">
            <UserPlus className="size-4" />
            Add contact
          </Button>
        ) : null}
      </div>

      {/* Add Contact Form */}
      {showForm ? (
        <Card className="p-4 sm:p-5">
          <form onSubmit={handleAddContact} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">Name</Label>
                <Input
                  id="contact-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-role">Role</Label>
                <Input
                  id="contact-role"
                  value={form.roleTitle}
                  onChange={(e) => setForm((f) => ({ ...f, roleTitle: e.target.value }))}
                  placeholder="Recruiter, hiring manager…"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-link">LinkedIn or other link (optional)</Label>
              <Input
                id="contact-link"
                type="url"
                value={form.link}
                onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                placeholder="https://www.linkedin.com/in/…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-notes">Note (optional)</Label>
              <Textarea
                id="contact-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="How you know them, what you talked about…"
                rows={2}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save contact
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* Contacts List or Empty State */}
      {contacts.length === 0 ? (
        showForm ? null : (
          <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
            <div className="bg-primary/10 rounded-full p-4 mb-4">
              <Users className="size-8 text-primary" />
            </div>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              No contacts for this job. Add someone you know or found yourself.
            </p>
            <Button onClick={() => setShowForm(true)} variant="outline" className="gap-2">
              <UserPlus className="size-4" />
              Add contact
            </Button>
          </Card>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{contacts.length} contact{contacts.length === 1 ? '' : 's'}</span>
          </div>

          <div className="grid gap-4">
            {contacts.map((contact) => (
              <Card key={contact.id} className="p-4 sm:p-5 transition-all space-y-4" data-contact-id={contact.id}>
                {/* Header row: Name, Role, Status, and Status selector */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-base font-semibold text-foreground">
                        {contact.name}
                      </span>
                      <StatusPill status={contact.status} />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {contact.roleTitle}
                    </p>
                    {contact.relevance ? (
                      <p className="text-xs text-muted-foreground/90 mt-1">
                        <span className="font-medium text-foreground/80">Relevance:</span> {contact.relevance}
                      </p>
                    ) : null}
                    {contact.notes ? (
                      <p className="text-xs text-muted-foreground whitespace-pre-line mt-1">{contact.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                    <div className="w-36">
                      <OptionSelect
                        size="sm"
                        value={contact.status}
                        options={STATUS_OPTIONS}
                        onValueChange={(val) => handleStatusChange(contact.id, val)}
                        aria-label={`Update status for ${contact.name}`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(contact.id, contact.name)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${contact.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* Links */}
                {contact.evidence && contact.evidence.length > 0 ? (
                  <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Globe className="size-3.5 text-primary" />
                      <span>Links</span>
                    </div>
                    <div className="space-y-1 pl-5">
                      {contact.evidence.map((item, idx) => (
                        <div key={idx} className="flex flex-wrap items-baseline gap-1.5">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                          >
                            <span>{item.title || item.url}</span>
                            <ExternalLink className="size-3" />
                          </a>
                          {item.snippet ? (
                            <span className="text-muted-foreground/80 italic">— {item.snippet}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Channels & Action Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/40">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                      >
                        <Mail className="size-3.5 text-primary" />
                        <span>{contact.email}</span>
                      </a>
                    ) : null}
                    {contact.linkedinUrl ? (
                      <a
                        href={contact.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                      >
                        <LinkedInIcon className="size-3.5 text-[#0A66C2]" />
                        <span>LinkedIn</span>
                        <ExternalLink className="size-2.5" />
                      </a>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={contact.status === 'outreach_drafted' ? 'outline' : 'default'}
                      onClick={() => handleDraftOutreach(contact)}
                      disabled={draftingId === contact.id}
                      className="gap-1.5"
                      id={`draft-outreach-${contact.id}`}
                    >
                      {draftingId === contact.id ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          Drafting...
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-3.5" />
                          {contact.status === 'outreach_drafted' ? 'Re-draft Outreach' : 'Draft Outreach'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Active Draft Inline Preview */}
                {activeDraft && activeDraft.contactId === contact.id ? (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-primary" />
                        <span className="font-heading text-xs font-semibold text-foreground uppercase tracking-wide">
                          Outreach Draft
                        </span>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => handleCopy(activeDraft.draftText, contact.id)}
                        className="gap-1 text-xs"
                      >
                        {copiedId === contact.id ? (
                          <>
                            <Check className="size-3 text-emerald-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            Copy Draft
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="text-xs whitespace-pre-wrap font-sans bg-background/80 p-3 rounded border text-foreground/90 leading-relaxed">
                      {activeDraft.draftText}
                    </pre>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
