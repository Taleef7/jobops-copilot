'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { LocalDate } from '@/components/local-date';
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
import type { CoverLetterLength, ResumeChangeDetail, ResumeVersionRecord } from '@/types/job';
import { LENGTH_HINT, LengthToggle, setTailorKeywords, startCoverLetter } from './cover-letter-review';

/**
 * Tailoring a résumé to a job (#351): a window to confirm the posting's keywords the user has,
 * then a review of the AI's suggestions, each checked by the API against the base résumé. Each
 * line can be kept, restored or edited; one Download approves the draft and saves the PDF. The
 * window can also write a cover letter (#416), shown by CoverLetterReview.
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

const MAX_KEYWORDS = 25;
const MAX_KEYWORD_LENGTH = 60;

const modelName = (model: string) => model.split(':').pop() ?? model;

interface TailorError {
  message: string;
  code?: string;
  retry?: TailorOptions;
}

interface TailorState {
  /** Versions this session made or changed (a new run, a line in the review), each at its latest. */
  seen: ResumeVersionRecord[];
  /** The version shown; null for the newest. */
  selectedId: string | null;
  run: { startedAt: number; options: TailorOptions } | null;
  error: TailorError | null;
  /** A line of the review is being saved: Download waits, here too after a tab switch. */
  saving: boolean;
  /** The draft is being approved and downloaded. */
  downloading: boolean;
}

// A tailoring run takes 20 to 40 seconds. Its state is kept here, per job, not in the
// component, so it carries on when the user switches to another tab of the job page and back,
// and that tab shows the draft it made rather than the page's older list of versions.
const EMPTY: TailorState = { seen: [], selectedId: null, run: null, error: null, saving: false, downloading: false };
const tailorStates = new Map<string, TailorState>();
const listeners = new Set<() => void>();

function setTailorState(jobId: string, patch: Partial<TailorState>) {
  tailorStates.set(jobId, { ...(tailorStates.get(jobId) ?? EMPTY), ...patch });
  listeners.forEach((listener) => listener());
}

/** Remember a version this session made or changed. */
function see(jobId: string, version: ResumeVersionRecord, patch: Partial<TailorState> = {}) {
  const { seen } = tailorStates.get(jobId) ?? EMPTY;
  setTailorState(jobId, { seen: [version, ...seen.filter((v) => v.id !== version.id)], ...patch });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: forget runs and drafts left over from an earlier test. */
export function resetTailorStoreForTests() {
  tailorStates.clear();
}

function startTailoring(jobId: string, options: TailorOptions) {
  if (tailorStates.get(jobId)?.run) return;
  setTailorState(jobId, { run: { startedAt: Date.now(), options }, error: null });
  // One handler per run, whichever tab is showing: one toast.
  tailorResumeForJob(jobId, options).then(
    ({ version, addedToBase }) => {
      // The new draft is shown; earlier versions stay in the list.
      see(jobId, version, { selectedId: version.id, run: null });
      toast.success('Your tailored résumé is ready to review.');
      if (addedToBase === false) {
        toast.warning("Your draft is ready, but the keywords couldn't be added to your base résumé. Add them in Settings → Résumé.");
      }
    },
    (err: unknown) => {
      const { code, status } = (err ?? {}) as { code?: unknown; status?: unknown };
      setTailorState(jobId, {
        run: null,
        error: {
          message: err instanceof Error ? err.message : "Your résumé couldn't be tailored.",
          code: typeof code === 'string' ? code : undefined,
          retry: typeof status === 'number' && status >= 500 ? options : undefined,
        },
      });
    },
  );
}

/**
 * The page's versions and the ones this session saw, each at its latest (the page's list can be
 * older than what this session saw), newest first.
 */
function allVersions(seen: ResumeVersionRecord[], page: ResumeVersionRecord[]): ResumeVersionRecord[] {
  const byId = new Map<string, ResumeVersionRecord>();
  for (const version of [...page, ...seen]) {
    const known = byId.get(version.id);
    if (!known || version.updatedAt >= known.updatedAt) byId.set(version.id, version);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt));
}

export function TailoredResumeReview({ jobId, jobCompany, initialVersions = [] }: TailoredResumeReviewProps) {
  const state = useSyncExternalStore(
    subscribe,
    () => tailorStates.get(jobId) ?? EMPTY,
    () => EMPTY,
  );
  const versions = allVersions(state.seen, initialVersions);
  const version = versions.find((v) => v.id === state.selectedId) ?? versions[0] ?? null;
  const startedAt = state.run?.startedAt ?? null;
  const error = state.error;
  const [windowOpen, setWindowOpen] = useState(false);
  // A new window each time it opens: the keywords are read again (a run may have added some to
  // the base résumé), with nothing picked.
  const [windowKey, setWindowKey] = useState(0);
  const setVersion = (next: ResumeVersionRecord) => see(jobId, next);
  const setSaving = (saving: boolean) => setTailorState(jobId, { saving });

  function openWindow() {
    setWindowKey((key) => key + 1);
    setWindowOpen(true);
  }

  function tailor(options: TailorOptions, letter: CoverLetterLength | null = null) {
    setWindowOpen(false);
    startTailoring(jobId, options);
    // A letter written again later uses these keywords too.
    setTailorKeywords(jobId, options.confirmedKeywords);
    // The letter runs alongside, from the same keywords; it has its own progress and errors.
    if (letter) startCoverLetter(jobId, { length: letter, confirmedKeywords: options.confirmedKeywords });
  }

  return (
    <div className="space-y-4">
      {startedAt !== null ? (
        <TailoringProgress startedAt={startedAt} />
      ) : version ? (
        <>
          {versions.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Versions">
              <span className="text-muted-foreground text-xs">Versions:</span>
              {versions.map((v, index) => (
                <Button
                  key={v.id}
                  size="sm"
                  variant={v.id === version.id ? 'default' : 'outline'}
                  aria-pressed={v.id === version.id}
                  disabled={state.saving || state.downloading}
                  onClick={() => setTailorState(jobId, { selectedId: v.id })}
                >
                  {`v${versions.length - index} · ${v.approved ? 'Downloaded' : 'Draft'}`}
                </Button>
              ))}
            </div>
          ) : null}
          <VersionReview
            version={version}
            company={jobCompany}
            onChange={setVersion}
            saving={state.saving}
            onSaving={setSaving}
            downloading={state.downloading}
            onDownloading={(downloading) => setTailorState(jobId, { downloading })}
            onTailorAgain={openWindow}
          />
        </>
      ) : (
        <Card className="space-y-3 p-6">
          <h3 className="font-heading text-base font-semibold">Tailor your résumé to {jobCompany}</h3>
          <p className="text-muted-foreground text-sm">
            The AI rewords and reorders what your base résumé already says, for this posting. Every suggestion is
            checked against your résumé, and you review each line before you download.
          </p>
          <p className="text-muted-foreground text-xs">Single-column PDF with selectable text.</p>
          <div>
            <Button onClick={openWindow}>Tailor résumé</Button>
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
              <Button size="sm" variant="outline" onClick={() => tailor(error.retry!)}>
                Try again
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <TailorWindow key={windowKey} jobId={jobId} open={windowOpen} onOpenChange={setWindowOpen} onTailor={tailor} />
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
  onTailor: (options: TailorOptions, letter: CoverLetterLength | null) => void;
}) {
  const [loaded, setLoaded] = useState<{
    fitRead: boolean;
    keywords: Array<{ term: string; onResume: boolean }>;
    failed?: boolean;
  } | null>(null);
  const loading = open && loaded === null;
  const fitRead = loaded?.fitRead ?? true;
  const keywords = loaded?.keywords ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [addToBase, setAddToBase] = useState(false);
  const [withLetter, setWithLetter] = useState(false);
  const [letterLength, setLetterLength] = useState<CoverLetterLength>('concise');

  // The posting's keywords, read when the window opens (it's a new window each time).
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    getTailorKeywords(jobId)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch(() => {
        if (!cancelled) setLoaded({ fitRead: false, keywords: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, open, loaded]);

  const missing = keywords.filter((keyword) => !keyword.onResume);
  const present = keywords.filter((keyword) => keyword.onResume);
  const confirmed = [...missing.map((k) => k.term).filter((term) => picked.includes(term)), ...custom];
  // The API takes up to 25.
  const full = confirmed.length >= MAX_KEYWORDS;

  function addCustom() {
    const keyword = draft.trim();
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH || full) return;
    if (![...custom, ...picked].some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
      setCustom((current) => [...current, keyword]);
    }
    setDraft('');
  }

  const toggle = (term: string) =>
    setPicked((current) => (current.includes(term) ? current.filter((t) => t !== term) : full ? current : [...current, term]));

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
          ) : loaded?.failed ? (
            <p className="text-muted-foreground">Couldn&apos;t read the posting&apos;s keywords. You can still add your own.</p>
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
                        disabled={full && !picked.includes(keyword.term)}
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
              <Button type="button" variant="outline" onClick={addCustom} disabled={full}>
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

          {full ? <p className="text-muted-foreground text-xs">Up to {MAX_KEYWORDS} keywords.</p> : null}

          {confirmed.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={addToBase} onChange={(event) => setAddToBase(event.target.checked)} />
              Also add them to my base résumé
            </label>
          ) : null}

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withLetter} onChange={(event) => setWithLetter(event.target.checked)} />
              Also write a cover letter
            </label>
            {withLetter ? (
              <div className="space-y-1.5 pl-6">
                <LengthToggle value={letterLength} onChange={setLetterLength} />
                <p className="text-muted-foreground text-xs">{LENGTH_HINT}</p>
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter>
          <Button
            onClick={() =>
              onTailor({ confirmedKeywords: confirmed, addToBase: confirmed.length > 0 && addToBase }, withLetter ? letterLength : null)
            }
          >
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
  company,
  onChange,
  saving,
  onSaving,
  downloading,
  onDownloading,
  onTailorAgain,
}: {
  version: ResumeVersionRecord;
  /** The job's company: the download is named "First Last – Company.pdf". */
  company: string;
  onChange: (version: ResumeVersionRecord) => void;
  /** One line at a time: each save changes the whole draft, and Download waits for it. */
  saving: boolean;
  onSaving: (saving: boolean) => void;
  /** Approving and downloading: one at a time, here too after a tab switch. */
  downloading: boolean;
  onDownloading: (downloading: boolean) => void;
  onTailorAgain: () => void;
}) {
  const basis = version.basedOn ?? null;
  const editable = Boolean(basis) && !version.approved;
  const changes = version.changeDetails ?? [];

  async function download() {
    onDownloading(true);
    try {
      let current = version;
      // Downloading is the approval (#351): the draft becomes final.
      if (!current.approved) {
        current = (await approveResumeVersion(current.id)).version;
        onChange(current);
      }
      const name = current.structuredResume.basics?.name?.trim() || 'Resume';
      // "First Last – Company.pdf" (no "Inc..pdf").
      const result = await downloadResumeVersion(current.id, `${name} – ${company.trim().replace(/\.+$/, '') || 'Résumé'}.pdf`);
      if (result?.unsupported) {
        toast.warning(
          `${result.unsupported} characters in your résumé can't be printed in its font (Chinese, Japanese, Korean, Arabic, emoji…) and show as "?".`,
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "The PDF couldn't be downloaded.");
    } finally {
      onDownloading(false);
    }
  }

  async function review(detail: ResumeChangeDetail, action: ReviewAction, text?: string): Promise<boolean> {
    onSaving(true);
    try {
      onChange(await reviewResumeChange(version.id, detail.id!, action, text));
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "That change couldn't be saved.");
      return false;
    } finally {
      onSaving(false);
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
                Based on your base résumé saved <LocalDate value={basis.baseUpdatedAt} fallback="unknown date" /> and
                this posting · {modelName(basis.model)} · tailored <LocalDate value={basis.createdAt} />
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onTailorAgain}>
              Tailor again
            </Button>
            <Button onClick={download} disabled={downloading || saving}>
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
        ) : basis?.layoutFrozenAt ? (
          <p className="text-muted-foreground text-xs">
            The PDF keeps the section order and headings your résumé had when this job moved to Applied or later.
          </p>
        ) : basis ? (
          // #415: a draft prints in the base résumé's layout until it's downloaded.
          <p className="text-muted-foreground text-xs">
            The PDF uses the section order and headings set in Settings → Résumé until you download it.
          </p>
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
            key={`${version.id}-${detail.id ?? index}`}
            detail={detail}
            editable={editable && Boolean(detail.id)}
            busy={saving || downloading}
            onReview={review}
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

type ReviewAction = 'keep' | 'restore' | 'edit';

function ChangeCard({
  detail,
  editable,
  busy,
  onReview,
}: {
  detail: ResumeChangeDetail;
  editable: boolean;
  busy: boolean;
  onReview: (detail: ResumeChangeDetail, action: ReviewAction, text?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  // A dropped suggestion adds something the résumé lacks: editing starts from the base line.
  const [text, setText] = useState(detail.userText ?? (detail.dropped ? (detail.oldText ?? '') : detail.newText));
  // A line of the base résumé; a suggestion that matched none has nothing to change.
  const isLine = detail.kind === 'rewrite' && Boolean(detail.sourcePath);
  const isAddedSkill = detail.kind === 'skill-added' && !detail.dropped;

  async function act(action: ReviewAction, value?: string) {
    if (await onReview(detail, action, value)) setEditing(false);
  }

  const shown =
    detail.resolution === 'edited' ? (detail.userText ?? detail.newText) : detail.resolution === 'restored' ? detail.oldText : detail.newText;

  return (
    <Card className="space-y-3 p-5" data-testid={detail.id ? `change-${detail.id}` : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{detail.section}</span>
        {detail.resolution ? (
          <span className="text-xs font-medium">
            {isAddedSkill && detail.resolution === 'restored' ? 'Removed' : RESOLUTION_LABEL[detail.resolution]}
          </span>
        ) : null}
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
            <Textarea
              aria-label="Your words for this line"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
            />
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
              {isLine && (!detail.dropped || detail.resolution === 'edited') ? (
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
