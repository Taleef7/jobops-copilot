'use client';

import { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { OptionSelect } from '@/components/ui/option-select';
import {
  deleteContact,
  draftContactOutreach,
  scoutJobContacts,
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
  const [isScouting, setIsScouting] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<{
    contactId: string;
    draftText: string;
  } | null>(null);

  async function handleScout() {
    setIsScouting(true);
    try {
      const res = await scoutJobContacts(jobId);
      setContacts(res.contacts);
      if (res.newDiscovered > 0) {
        toast.success(`Discovered ${res.newDiscovered} new verified contacts at ${company}`);
      } else {
        toast.info(`Contacts for ${company} are up to date (${res.count} verified contacts)`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to scout contacts';
      toast.error(msg);
    } finally {
      setIsScouting(false);
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
      toast.success(`Personalized outreach drafted for ${contact.name}`);
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
      {/* Top Banner & Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              Connection Scout & People
            </h2>
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
              <ShieldCheck className="size-3.5" />
              Verified Public Evidence
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Verified recruiters and hiring leaders for {company}. Strictly fail-closed to public web directories.
          </p>
        </div>
        <Button
          onClick={handleScout}
          disabled={isScouting}
          className="gap-2 shrink-0"
          id="scout-people-btn"
        >
          {isScouting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Scouting...
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Scout People
            </>
          )}
        </Button>
      </div>

      {/* Fail-closed Notice */}
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5 text-xs text-muted-foreground flex items-start gap-2.5">
        <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-foreground">Fail-Closed Guarantee:</span> Every contact
          discovered carries verifiable public directory URLs. We never scrape private networks, and
          outreach drafts are strictly approve-then-send (never auto-sent).
        </div>
      </div>

      {/* Contacts List or Empty State */}
      {contacts.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="bg-primary/10 rounded-full p-4 mb-4">
            <Users className="size-8 text-primary" />
          </div>
          <h3 className="font-heading text-base font-semibold">No contacts scouted yet</h3>
          <p className="text-muted-foreground text-sm max-w-sm mt-1 mb-6">
            Click &ldquo;Scout People&rdquo; to discover hiring managers, technical recruiters, and team
            leads at {company} backed by public directory evidence.
          </p>
          <Button onClick={handleScout} disabled={isScouting} className="gap-2">
            {isScouting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Scouting {company}...
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Scout People Now
              </>
            )}
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{contacts.length} verified contact{contacts.length === 1 ? '' : 's'}</span>
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

                {/* Evidence Section */}
                {contact.evidence && contact.evidence.length > 0 ? (
                  <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Globe className="size-3.5 text-primary" />
                      <span>Verified Public Evidence:</span>
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
                        <span>Company Profile</span>
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
                          Personalized Outreach Draft
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
