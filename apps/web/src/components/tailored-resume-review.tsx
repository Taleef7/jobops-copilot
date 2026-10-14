'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  approveResumeVersion,
  downloadResumeVersion,
  getTailorKeywords,
  reviewResumeChange,
  tailorResumeForJob,
} from '@/lib/api';
import type { ResumeChangeDetail, ResumeVersionRecord } from '@/types/job';

/**
 * Tailoring a résumé to a job (#351): a window to confirm the posting's keywords the user has,
 * then a review of the AI's suggestions, each checked by the API against the base résumé. Each
 * line can be kept, restored or edited; one Download approves the draft and saves the PDF.
 */

interface TailoredResumeReviewProps {
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  initialVersions?: ResumeVersionRecord[];
}

interface TailorOptions {
  confirmedKeywords: string[];
  addToBase: boolean;
}

// A tailoring run takes 20 to 40 seconds. It's kept here, not in component state, so it
// carries on when the user switches to another tab of the job page and back.
const pendingTailors = new Map<string, { promise: Promise<ResumeVersionRecord>; startedAt: number }>();

/** For tests: forget runs left over from an earlier test. */
export function resetPendingTailorsForTests() {
  pendingTailors.clear();
}

const MAX_KEYWORDS = 25;
const MAX_KEYWORD_LENGTH = 60;

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : 'unknown date');
const modelName = (model: string) => model.split(':').pop() ?? model;

interface TailorError {
  message: string;
  code?: string;
  retry?: TailorOptions;
}

export function TailoredResumeReview({ jobId, jobCompany, initialVersions = [] }: TailoredResumeReviewProps) {
  const [version, setVersion] = useState<ResumeVersionRecord | null>(initialVersions[0] ?? null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(pendingTailors.get(jobId)?.startedAt ?? null);
  const [error, setError] = useState<TailorError | null>(null);

  // State changes only in the promise's callbacks, never synchronously.
  function follow(promise: Promise<ResumeVersionRecord>, options: TailorOptions) {
    return promise
      .then((created) => {
        setVersion(created);
        toast.success('Your tailored résumé is ready to review.');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Your résumé couldn't be tailored.";
        const { code, status } = (err ?? {}) as { code?: unknown; status?: unknown };
        setError({
          message,
          code: typeof code === 'string' ? code : undefined,
          retry: typeof status === 'number' && status >= 500 ? options : undefined,
        });
      })
      .finally(() => {
        pendingTailors.delete(jobId);
        setStartedAt(null);
      });
  }

  function startTailoring(options: TailorOptions) {
    setWindowOpen(false);
    setError(null);
    const run = { promise: tailorResumeForJob(jobId, options), startedAt: Date.now() };
    pendingTailors.set(jobId, run);
    setStartedAt(run.startedAt);
    void follow(run.promise, options);
  }

  // Back on this tab while a run is still going: wait for it here.
  useEffect(() => {
    const run = pendingTailors.get(jobId);
    if (run) void follow(run.promise, { confirmedKeywords: [], addToBase: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return (
    <div className="space-y-4">
      {startedAt !== null ? (
        <TailoringProgress startedAt={startedAt} />
      ) : version ? (
        <VersionReview version={version} onChange={setVersion} onTailorAgain={() => setWindowOpen(true)} />
      ) : (
        <Card className="space-y-3 p-6">
          <h3 className="font-heading text-base font-semibold">Tailor your résumé to {jobCompany}</h3>
          <p className="text-muted-foreground text-sm">
            The AI rewords and reorders what your base résumé already says, for this posting. Every suggestion is
            checked against your résumé, and you review each line before you download.
          </p>
          <p className="text-muted-foreground text-xs">Single-column PDF with selectable text.</p>
          <div>
            <Button onClick={() => setWindowOpen(true)}>Tailor résumé</Button>
          </div>
        </Card>
      )}

      {error && startedAt === null ? (
        <Card className="space-y-2 border-destructive/40 p-4 text-sm" role="alert">
          <p>{error.message}</p>
          {error.code === 'BASE_RESUME_EMPTY' || error.code === 'RESUME_LINES_TOO_LONG' ? (
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Open Settings → Résumé
            </Link>
          ) : null}
          {error.retry ? (
            <div>
              <Button size="sm" variant="outline" onClick={() => startTailoring(error.retry!)}>
                Try again
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <TailorWindow jobId={jobId} open={windowOpen} onOpenChange={setWindowOpen} onTailor={startTailoring} />
    </div>
  );
}

function TailoringProgress({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <Card className="flex items-center gap-3 p-5 text-sm" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>
        Tailoring your résumé… {seconds}s. This usually takes 20 to 40 seconds; you can switch tabs meanwhile.
      </span>
    </Card>
  );
}

function TailorWindow({
  jobId,
  open,
  onOpenChange,
  onTailor,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTailor: (options: TailorOptions) => void;
}) {
  const [loaded, setLoaded] = useState<{ fitRead: boolean; keywords: Array<{ term: string; onResume: boolean }> } | null>(null);
  const loading = open && loaded === null;
  const fitRead = loaded?.fitRead ?? true;
  const keywords = loaded?.keywords ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [addToBase, setAddToBase] = useState(false);

  // The posting's keywords, read once when the window first opens.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    getTailorKeywords(jobId)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch(() => {
        if (!cancelled) setLoaded({ fitRead: false, keywords: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, open, loaded]);

  const missing = keywords.filter((keyword) => !keyword.onResume);
  const present = keywords.filter((keyword) => keyword.onResume);
  const confirmed = [...missing.map((k) => k.term).filter((term) => picked.includes(term)), ...custom];

  function addCustom() {
    const keyword = draft.trim();
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH || confirmed.length >= MAX_KEYWORDS) return;
    if (![...custom, ...picked].some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
      setCustom((current) => [...current, keyword]);
    }
    setDraft('');
  }

  const toggle = (term: string) =>
    setPicked((current) => (current.includes(term) ? current.filter((t) => t !== term) : [...current, term]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tailor your résumé</SheetTitle>
          <SheetDescription>
            Pick the posting&apos;s keywords you have, or add your own. Only those, and what your base résumé already
            says, can go into the tailored version.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Reading the posting&apos;s keywords…</p>
          ) : !fitRead ? (
            <p className="text-muted-foreground">
              Run a fit read to see the posting&apos;s keywords here. You can still add keywords you have.
            </p>
          ) : (
            <>
              {present.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">On your résumé</p>
                  <div className="flex flex-wrap gap-1.5">
                    {present.map((keyword) => (
                      <span key={keyword.term} className="bg-muted rounded-md px-2 py-1 text-xs">
                        {keyword.term}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {missing.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    Not on your résumé: pick the ones you have
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.map((keyword) => (
                      <Button
                        key={keyword.term}
                        type="button"
                        size="sm"
                        variant={picked.includes(keyword.term) ? 'default' : 'outline'}
                        aria-pressed={picked.includes(keyword.term)}
                        onClick={() => toggle(keyword.term)}
                      >
                        {keyword.term}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="space-y-2">
            <label htmlFor="tailor-custom-keyword" className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Add a keyword you have
            </label>
            <div className="flex gap-2">
              <Input
                id="tailor-custom-keyword"
                value={draft}
                maxLength={MAX_KEYWORD_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCustom();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addCustom}>
                <Plus className="size-4" aria-hidden />
                Add
              </Button>
            </div>
            {custom.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {custom.map((keyword) => (
                  <span key={keyword} className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                    {keyword}
                    <button
                      type="button"
                      aria-label={`Remove ${keyword}`}
                      onClick={() => setCustom((current) => current.filter((k) => k !== keyword))}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {confirmed.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={addToBase} onChange={(event) => setAddToBase(event.target.checked)} />
              Also add them to my base résumé
            </label>
          ) : null}
        </div>

        <SheetFooter>
          <Button onClick={() => onTailor({ confirmedKeywords: confirmed, addToBase: confirmed.length > 0 && addToBase })}>
            {confirmed.length > 0
              ? `Tailor with ${confirmed.length} keyword${confirmed.length === 1 ? '' : 's'}`
              : 'Tailor résumé'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function VersionReview({
  version,
  onChange,
  onTailorAgain,
}: {
  version: ResumeVersionRecord;
  onChange: (version: ResumeVersionRecord) => void;
  onTailorAgain: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const basis = version.basedOn ?? null;
  const editable = Boolean(basis) && !version.approved;
  const changes = version.changeDetails ?? [];

  async function download() {
    setDownloading(true);
    try {
      let current = version;
      // Downloading is the approval (#351): the draft becomes final.
      if (!current.approved) {
        current = (await approveResumeVersion(current.id)).version;
        onChange(current);
      }
      const name = current.structuredResume.basics?.name || 'Resume';
      await downloadResumeVersion(current.id, `${name.replace(/\s+/g, '_')}_tailored.pdf`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "The PDF couldn't be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="font-heading text-base font-semibold">Tailored résumé</h3>
            {basis ? (
              <p className="text-muted-foreground text-xs">
                Based on your base résumé saved {day(basis.baseUpdatedAt)} and this posting · {modelName(basis.model)} ·
                tailored {day(basis.createdAt)}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onTailorAgain}>
              Tailor again
            </Button>
            <Button onClick={download} disabled={downloading}>
              {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Download PDF
            </Button>
          </div>
        </div>
        <p className="text-sm">{version.changeSummary}</p>
        {basis?.coverage ? (
          <p className="text-muted-foreground text-xs">
            {`Posting keywords in your résumé: ${basis.coverage.before} of ${basis.coverage.total} → ${basis.coverage.after} of ${basis.coverage.total}`}
          </p>
        ) : null}
        {version.approved ? (
          <p className="text-muted-foreground text-xs">Downloaded. To change it, tailor again.</p>
        ) : null}
        {basis?.gaps?.length ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium">The posting asks for these, which your résumé doesn&apos;t show:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {basis.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {changes.length === 0 ? (
        <Card className="text-muted-foreground p-5 text-sm">No line-by-line changes recorded for this version.</Card>
      ) : (
        changes.map((detail, index) => (
          <ChangeCard
            key={detail.id ?? index}
            versionId={version.id}
            detail={detail}
            editable={editable && Boolean(detail.id)}
            onChange={onChange}
          />
        ))
      )}
    </div>
  );
}

const RESOLUTION_LABEL: Record<NonNullable<ResumeChangeDetail['resolution']>, string> = {
  kept: 'Kept',
  restored: 'Restored',
  edited: 'Your words',
};

function ChangeCard({
  versionId,
  detail,
  editable,
  onChange,
}: {
  versionId: string;
  detail: ResumeChangeDetail;
  editable: boolean;
  onChange: (version: ResumeVersionRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(detail.userText ?? detail.newText);
  const [busy, setBusy] = useState(false);
  const isLine = detail.kind === 'rewrite';
  const isAddedSkill = detail.kind === 'skill-added' && !detail.dropped;

  async function act(action: 'keep' | 'restore' | 'edit', value?: string) {
    setBusy(true);
    try {
      onChange(await reviewResumeChange(versionId, detail.id!, action, value));
      setEditing(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "That change couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  const shown =
    detail.resolution === 'edited' ? (detail.userText ?? detail.newText) : detail.resolution === 'restored' ? detail.oldText : detail.newText;

  return (
    <Card className="space-y-3 p-5" data-testid={detail.id ? `change-${detail.id}` : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{detail.section}</span>
        {detail.resolution ? <span className="text-xs font-medium">{RESOLUTION_LABEL[detail.resolution]}</span> : null}
      </div>

      {detail.dropped ? (
        <p className="bg-muted/40 rounded-md border p-2 text-xs">
          {`Suggestion dropped: ${detail.dropReason ?? "it isn't supported by your base résumé"}`}
        </p>
      ) : null}
      {!detail.dropped && detail.needsReview && (detail.issues?.length || detail.confirmedTerms?.length) ? (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          {(detail.issues ?? []).map((issue, i) => (
            <p key={i}>{`Check this line: ${issue.message}`}</p>
          ))}
          {detail.confirmedTerms?.length ? <p>{`Uses ${detail.confirmedTerms.join(', ')}, which you added`}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Your base résumé</p>
          <p className="text-muted-foreground whitespace-pre-wrap">{detail.oldText || '(new)'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{detail.dropped && detail.resolution !== 'edited' ? 'Suggested, not used' : 'Tailored'}</p>
          {editing ? (
            <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} />
          ) : (
            <p className={`whitespace-pre-wrap ${detail.dropped && detail.resolution !== 'edited' ? 'text-muted-foreground line-through' : ''}`}>
              {detail.dropped && detail.resolution !== 'edited' ? detail.newText : shown}
            </p>
          )}
        </div>
      </div>

      {detail.rationale ? <p className="text-muted-foreground text-xs">Why: {detail.rationale}</p> : null}

      {editable && (isLine || isAddedSkill) ? (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={busy || !text.trim()} onClick={() => act('edit', text.trim())}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {!detail.dropped ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act('keep')}>
                  Keep
                </Button>
              ) : null}
              {isLine && !detail.dropped ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act('restore')}>
                  Restore original
                </Button>
              ) : null}
              {isAddedSkill ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act('restore')}>
                  Remove
                </Button>
              ) : null}
              {isLine ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
