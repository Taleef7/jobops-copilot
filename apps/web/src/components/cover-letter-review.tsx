'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LocalDate } from '@/components/local-date';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  downloadCoverLetter,
  editCoverLetterParagraph,
  getCoverLetter,
  removeCoverLetterParagraph,
  resolveCoverLetterFlag,
  writeCoverLetter,
} from '@/lib/api';
import type { CoverLetterCheck, CoverLetterLength, CoverLetterParagraph, CoverLetterRecord } from '@/types/job';

/**
 * The job's cover letter (#416), written from the tailor window or here: Concise or Full, always
 * one page. The API drops the sentences its check can prove unsupported, and flags the ones it can
 * only guess about: this shows the letter with its flags highlighted, each to keep or remove,
 * what the check left out, and lets each paragraph be edited. Download waits for every flag.
 */

export interface WriteOptions {
  length: CoverLetterLength;
  confirmedKeywords: string[];
}

interface LetterError {
  message: string;
  code?: string;
  /** The AI failed this run: Try again writes it again, with the length the toggle shows. */
  retry?: WriteOptions;
  /** When it failed, on the store's clock: a length picked before it doesn't count. */
  at?: number;
  /** Read the letter again (reading it failed). */
  reload?: boolean;
}

interface LetterState {
  /** The job's letter; null when it has none, undefined before it is read. */
  letter: CoverLetterRecord | null | undefined;
  loading: boolean;
  run: { startedAt: number; options: WriteOptions } | null;
  error: LetterError | null;
  /** A paragraph is being saved: Download waits. */
  saving: boolean;
  downloading: boolean;
  /** The keywords confirmed in the latest tailoring, for a letter written again from the card. */
  tailorKeywords?: string[];
}

// A letter takes 10 to 30 seconds to write. Its state is kept here, per job, so a letter started
// in the tailor window, or before a switch to another tab, shows when this card is back.
const EMPTY: LetterState = { letter: undefined, loading: false, run: null, error: null, saving: false, downloading: false };
const states = new Map<string, LetterState>();
const listeners = new Set<() => void>();
/** Bumped by every change this page makes to a job's letter: a read started before it is stale. */
const generations = new Map<string, number>();

const stateOf = (jobId: string) => states.get(jobId) ?? EMPTY;
/** A clock for "which came last": a failed run, or the length the user picked. */
let clock = 0;
const tick = () => (clock += 1);

function setLetterState(jobId: string, patch: Partial<LetterState>) {
  states.set(jobId, { ...stateOf(jobId), ...patch });
  listeners.forEach((listener) => listener());
}

/** The letter as this page just changed it. */
function setLetter(jobId: string, letter: CoverLetterRecord, patch: Partial<LetterState> = {}) {
  generations.set(jobId, (generations.get(jobId) ?? 0) + 1);
  setLetterState(jobId, { letter, ...patch });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: forget letters and runs left over from an earlier test. */
export function resetCoverLetterStoreForTests() {
  states.clear();
  generations.clear();
}

/** The keywords of the latest successful tailoring, so "Write again" uses them. */
export function setTailorKeywords(jobId: string, keywords: string[]) {
  setLetterState(jobId, { tailorKeywords: keywords });
}

export const tailorKeywordsOf = (jobId: string) => stateOf(jobId).tailorKeywords;

/** Write the job's letter (from the tailor window or this card). One run at a time per job. */
export function startCoverLetter(jobId: string, options: WriteOptions) {
  if (stateOf(jobId).run) return;
  setLetterState(jobId, { run: { startedAt: Date.now(), options }, error: null });
  writeCoverLetter(jobId, options).then(
    (letter) => {
      setLetter(jobId, letter, { run: null });
      toast.success('Your cover letter is ready to review.');
    },
    (err: unknown) => {
      const { code, status } = (err ?? {}) as { code?: unknown; status?: unknown };
      setLetterState(jobId, {
        run: null,
        error: {
          message: err instanceof Error ? err.message : "Your cover letter couldn't be written.",
          code: typeof code === 'string' ? code : undefined,
          retry: typeof status === 'number' && status >= 500 ? options : undefined,
          at: tick(),
        },
      });
    },
  );
}

/** Read the job's letter: each time the card shows, since another tab may have changed it. */
function loadCoverLetter(jobId: string) {
  if (stateOf(jobId).loading) return;
  const generation = generations.get(jobId) ?? 0;
  setLetterState(jobId, { loading: true });
  getCoverLetter(jobId).then(
    // A letter this page wrote or edited meanwhile is newer than what was read.
    (letter) =>
      setLetterState(
        jobId,
        (generations.get(jobId) ?? 0) === generation ? { letter: letter ?? null, loading: false } : { loading: false },
      ),
    () =>
      setLetterState(
        jobId,
        stateOf(jobId).letter === undefined
          ? { loading: false, error: { message: "Couldn't load your cover letter.", reload: true } }
          : { loading: false },
      ),
  );
}

const modelName = (model: string) => model.split(':').pop() ?? model;
const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Today in the browser's time zone (#412), for the letter's date: the API prints it as given. */
function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const LENGTH_LABEL: Record<CoverLetterLength, string> = { concise: 'Concise', full: 'Full' };
const KEY_SEPARATOR = '\u0000';

/** Concise or Full: two buttons, one pressed. */
export function LengthToggle({
  value,
  onChange,
  disabled,
}: {
  value: CoverLetterLength;
  onChange: (length: CoverLetterLength) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex gap-1" role="group" aria-label="Letter length">
      {(['concise', 'full'] as const).map((length) => (
        <Button
          key={length}
          type="button"
          size="sm"
          variant={value === length ? 'default' : 'outline'}
          aria-pressed={value === length}
          disabled={disabled}
          onClick={() => onChange(length)}
        >
          {LENGTH_LABEL[length]}
        </Button>
      ))}
    </div>
  );
}

export const LENGTH_HINT = 'Concise is about 150 to 200 words, Full about 300 to 400. Either way it is always one page.';

export function CoverLetterReview({
  jobId,
  jobCompany,
  defaultKeywords = [],
}: {
  jobId: string;
  jobCompany: string;
  /** Keywords the user confirmed when they last tailored, for a letter written from here. */
  defaultKeywords?: string[];
}) {
  const state = useSyncExternalStore(subscribe, () => stateOf(jobId), () => EMPTY);
  const [picked, setPicked] = useState<{ length: CoverLetterLength; at: number } | null>(null);
  const { letter, run, error } = state;
  // After a failed run, the toggle shows that run's length until another is picked after it.
  const pickedSince = picked && (!error?.retry || picked.at > (error.at ?? 0)) ? picked.length : null;
  const length = pickedSince ?? error?.retry?.length ?? picked?.length ?? letter?.length ?? 'concise';
  const pick = (next: CoverLetterLength) => setPicked({ length: next, at: tick() });

  useEffect(() => {
    loadCoverLetter(jobId);
  }, [jobId]);

  function write(
    options: WriteOptions = {
      length,
      confirmedKeywords: state.tailorKeywords ?? letter?.basedOn.confirmedKeywords ?? defaultKeywords,
    },
  ) {
    startCoverLetter(jobId, options);
  }

  return (
    <div className="space-y-4">
      {run ? (
        <LetterProgress startedAt={run.startedAt} />
      ) : letter ? (
        <LetterView
          jobId={jobId}
          letter={letter}
          length={length}
          onLength={pick}
          onWriteAgain={() => write()}
          saving={state.saving}
          downloading={state.downloading}
        />
      ) : letter === null ? (
        <Card className="space-y-3 p-6">
          <h3 className="font-heading text-base font-semibold">Cover letter for {jobCompany}</h3>
          <p className="text-muted-foreground text-sm">
            The AI writes it from your base résumé for this posting. Every sentence is checked against your résumé,
            and you can edit each paragraph before you download. {LENGTH_HINT}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <LengthToggle value={length} onChange={pick} />
            <Button onClick={() => write()}>Write cover letter</Button>
          </div>
        </Card>
      ) : !error ? (
        <p className="text-muted-foreground text-sm">Loading your cover letter…</p>
      ) : null}

      {error && !run ? (
        <Card className="space-y-2 border-destructive/40 p-4 text-sm" role="alert">
          <p>{error.message}</p>
          {error.code === 'BASE_RESUME_EMPTY' ? (
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Open Settings → Résumé
            </Link>
          ) : null}
          {error.retry || error.reload ? (
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (error.retry) write({ ...error.retry, length });
                  else {
                    setLetterState(jobId, { error: null });
                    loadCoverLetter(jobId);
                  }
                }}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function LetterProgress({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <Card className="flex flex-wrap items-center gap-x-3 gap-y-1 p-5 text-sm">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {/* Announced once; the seconds tick outside the live region. */}
      <span role="status">Writing your cover letter…</span>
      <span aria-hidden>{seconds}s.</span>
      <span>This usually takes 10 to 30 seconds; you can switch tabs meanwhile.</span>
    </Card>
  );
}

function LetterView({
  jobId,
  letter,
  length,
  onLength,
  onWriteAgain,
  saving,
  downloading,
}: {
  jobId: string;
  letter: CoverLetterRecord;
  length: CoverLetterLength;
  onLength: (length: CoverLetterLength) => void;
  onWriteAgain: () => void;
  saving: boolean;
  downloading: boolean;
}) {
  const basis = letter.basedOn;
  const words = letter.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph.text), 0);
  const dropped = letter.checks.filter((check) => check.dropped);
  const edited = letter.paragraphs.some((paragraph) => paragraph.edited);
  const unresolved = letter.checks.filter((check) => check.severity === 'flag' && check.paragraph !== null && !check.resolution);
  // The paragraph being edited, by its key, and what was typed: while one is open, nothing else
  // can change the letter. A key is the paragraph's text (and which copy of it), so it stays with
  // the paragraph when another one goes, and what was typed is kept here, not in the card.
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const keyOf = (index: number) => keyIn(letter, index);
  const editingOpen = editing !== null && letter.paragraphs.some((_paragraph, index) => keyOf(index) === editing.key);
  const locked = saving || downloading || editingOpen;

  async function download() {
    setLetterState(jobId, { downloading: true });
    try {
      const result = await downloadCoverLetter(jobId, localDate());
      if (result?.unsupported) {
        toast.warning(
          `${result.unsupported} characters in your letter can't be printed in its font (Chinese, Japanese, Korean, Arabic, emoji…) and show as "?".`,
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "The PDF couldn't be downloaded.");
    } finally {
      setLetterState(jobId, { downloading: false });
    }
  }

  // Text typed into a paragraph that another tab changed or removed: kept here to copy.
  const [unsaved, setUnsaved] = useState<string | null>(null);

  /**
   * The letter or a paragraph changed in another tab (409): read the letter as it is now, and say
   * so. An edit in progress stays open on its paragraph if it is still there, else its text is kept.
   */
  async function reread(kind: 'letter' | 'paragraph', typed: string | null) {
    const fresh = await getCoverLetter(jobId).catch(() => null);
    if (!fresh) {
      toast.error("The letter changed in another tab and couldn't be read again. Reload the page to see it.");
      return;
    }
    setLetter(jobId, fresh);
    const editedText = editing?.key.split(KEY_SEPARATOR)[1];
    if (typed === null || editedText === undefined) {
      toast.error(
        kind === 'letter'
          ? "This letter changed in another tab, so that wasn't saved. It now shows the latest version."
          : "That paragraph changed in another tab, so that wasn't saved. The letter now shows the latest version.",
      );
      return;
    }
    const at = fresh.paragraphs.findIndex((paragraph) => paragraph.text === editedText);
    if (at === -1) {
      setEditing(null);
      setUnsaved(typed);
      toast.error("That paragraph changed in another tab, so your edit wasn't saved. Your text is below the letter to copy.");
      return;
    }
    setEditing({ key: keyIn(fresh, at), text: typed });
    toast.error(
      kind === 'letter'
        ? "This letter changed in another tab, so your edit wasn't saved. It's still open: save it again."
        : "That paragraph moved in another tab, so your edit wasn't saved. It's still open: save it again.",
    );
  }

  async function change(run: () => Promise<CoverLetterRecord>, failure: string, typed: string | null = null): Promise<boolean> {
    setLetterState(jobId, { saving: true });
    try {
      setLetter(jobId, await run());
      return true;
    } catch (err: unknown) {
      const { status, code } = (err ?? {}) as { status?: unknown; code?: unknown };
      if (status === 409 && (code === 'PARAGRAPH_CHANGED' || code === 'LETTER_CHANGED')) {
        await reread(code === 'LETTER_CHANGED' ? 'letter' : 'paragraph', typed);
      } else {
        toast.error(err instanceof Error ? err.message : failure);
      }
      return false;
    } finally {
      setLetterState(jobId, { saving: false });
    }
  }

  // Each change names the paragraph by its text as shown, so the API refuses one that moved.
  const save = async (index: number, text: string) => {
    const saved = await change(
      () => editCoverLetterParagraph(jobId, index, text, letter.updatedAt, letter.paragraphs[index]!.text),
      "That paragraph couldn't be saved.",
      text,
    );
    if (saved) setEditing(null);
    return saved;
  };
  const remove = (index: number) =>
    change(
      () => removeCoverLetterParagraph(jobId, index, letter.updatedAt, letter.paragraphs[index]!.text),
      "That paragraph couldn't be removed.",
    );
  const resolve = (check: CoverLetterCheck, action: 'keep' | 'remove') =>
    change(
      () => resolveCoverLetterFlag(jobId, check.id, action, letter.paragraphs[check.paragraph!]!.text, letter.updatedAt),
      "That sentence couldn't be updated.",
    );

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-heading text-base font-semibold">{`Cover letter · ${LENGTH_LABEL[letter.length]}`}</h3>
          <p className="text-muted-foreground text-xs">
            Based on your base résumé saved <LocalDate value={basis.baseUpdatedAt} fallback="unknown date" /> and this posting ·{' '}
            {modelName(basis.model)} · written <LocalDate value={basis.createdAt} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LengthToggle value={length} onChange={onLength} disabled={locked} />
          <Button variant="outline" onClick={onWriteAgain} disabled={locked}>
            Write again
          </Button>
          <Button onClick={download} disabled={locked || unresolved.length > 0}>
            {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Download PDF
          </Button>
        </div>
      </div>
      {unresolved.length > 0 ? (
        <p className="text-xs font-medium">
          {`Keep or remove the ${unresolved.length === 1 ? '1 highlighted sentence' : `${unresolved.length} highlighted sentences`} before you download: the check couldn't confirm ${unresolved.length === 1 ? 'it' : 'them'} from your résumé.`}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {`${words} words, on one page. The PDF adds your name and contact line, the date, a greeting and a sign-off.`}
        {edited ? ' Writing it again replaces your edits.' : ''}
      </p>

      <div className="space-y-3">
        {letter.paragraphs.map((paragraph, index) => (
          <ParagraphCard
            key={keyOf(index)}
            index={index}
            paragraph={paragraph}
            checks={letter.checks.filter((check) => !check.dropped && check.paragraph === index)}
            draft={editing?.key === keyOf(index) ? editing.text : null}
            onDraft={(text) => setEditing({ key: keyOf(index), text })}
            onCancel={() => setEditing(null)}
            busy={saving || downloading || (editingOpen && editing?.key !== keyOf(index))}
            onSave={save}
            onRemove={letter.paragraphs.length > 1 ? remove : undefined}
            onResolve={resolve}
          />
        ))}
      </div>

      {unsaved !== null ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium">Your edit wasn&apos;t saved: that paragraph changed in another tab. Copy your text if you need it.</p>
          <Textarea aria-label="Your unsaved text" readOnly value={unsaved} rows={4} />
          <Button size="sm" variant="ghost" onClick={() => setUnsaved(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {dropped.length > 0 ? (
        <section aria-label="Left out by the check" className="bg-muted/40 space-y-2 rounded-md border p-3 text-xs">
          <p className="font-medium">Left out by the check against your base résumé:</p>
          <ul className="space-y-2">
            {dropped.map((check, i) => (
              <li key={i} className="space-y-0.5">
                <p className="text-muted-foreground line-through">{check.text}</p>
                <p>{`It ${check.dropReason ?? "isn't supported by your base résumé"}.`}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

/** A paragraph's key: the letter, its text, and which copy of that text it is. */
function keyIn(letter: CoverLetterRecord, index: number): string {
  const text = letter.paragraphs[index]!.text;
  const copy = letter.paragraphs.slice(0, index).filter((paragraph) => paragraph.text === text).length;
  return [letter.id, text, copy].join(KEY_SEPARATOR);
}

/** The paragraph's text with its unresolved flagged sentences highlighted. */
function Highlighted({ text, sentences }: { text: string; sentences: string[] }) {
  const parts: Array<{ text: string; marked: boolean }> = [];
  let rest = text;
  for (const sentence of sentences) {
    const at = rest.indexOf(sentence);
    if (at === -1) continue;
    if (at > 0) parts.push({ text: rest.slice(0, at), marked: false });
    parts.push({ text: sentence, marked: true });
    rest = rest.slice(at + sentence.length);
  }
  if (rest) parts.push({ text: rest, marked: false });
  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.marked ? (
          <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function ParagraphCard({
  index,
  paragraph,
  checks,
  draft,
  onDraft,
  onCancel,
  busy,
  onSave,
  onRemove,
  onResolve,
}: {
  index: number;
  paragraph: CoverLetterParagraph;
  /** The check's findings on this paragraph's sentences: flags to keep or remove, and notes. */
  checks: CoverLetterCheck[];
  /** What is typed while the paragraph is open; null when it isn't. */
  draft: string | null;
  onDraft: (text: string) => void;
  onCancel: () => void;
  /** Saving, downloading, or another paragraph is open: nothing here can change. */
  busy: boolean;
  onSave: (index: number, text: string) => Promise<boolean>;
  /** Absent for a letter's only paragraph. */
  onRemove?: (index: number) => Promise<boolean>;
  onResolve: (check: CoverLetterCheck, action: 'keep' | 'remove') => Promise<boolean>;
}) {
  const editing = draft !== null;
  // The user's own words are theirs: an edited paragraph's findings are settled.
  const flags = paragraph.edited ? [] : checks.filter((check) => check.severity === 'flag' && check.resolution !== 'removed');
  const open = flags.filter((check) => !check.resolution);
  const notes = paragraph.edited ? [] : checks.filter((check) => check.confirmedTerms?.length);

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`letter-paragraph-${index}`}>
      {paragraph.edited ? <p className="text-xs font-medium">Your words</p> : null}
      {editing ? (
        <Textarea aria-label={`Paragraph ${index + 1}`} value={draft} onChange={(event) => onDraft(event.target.value)} rows={5} />
      ) : (
        <Highlighted text={paragraph.text} sentences={open.map((check) => check.text)} />
      )}
      {flags.length > 0 || notes.length > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          {flags.map((check) => (
            <div key={check.id} className="space-y-1">
              {check.issues.map((found, j) => (
                <p key={j}>{`${check.resolution === 'kept' ? 'Kept ' : ''}“${check.text}”: it ${found.message}.`}</p>
              ))}
              {!check.resolution && !editing ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void onResolve(check, 'keep')}>
                    Keep
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void onResolve(check, 'remove')}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {notes.map((check) => (
            <p key={check.id}>{`Uses ${check.confirmedTerms!.join(', ')}, which you added`}</p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void onSave(index, draft.trim())}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Edit paragraph ${index + 1}`} onClick={() => onDraft(paragraph.text)}>
              Edit
            </Button>
            {onRemove ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Remove paragraph ${index + 1}`}
                onClick={() => void onRemove(index)}
              >
                Remove
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
