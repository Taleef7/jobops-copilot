'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LocalDate } from '@/components/local-date';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { downloadCoverLetter, editCoverLetterParagraph, getCoverLetter, removeCoverLetterParagraph, writeCoverLetter } from '@/lib/api';
import type { CoverLetterCheck, CoverLetterLength, CoverLetterParagraph, CoverLetterRecord } from '@/types/job';

/**
 * The job's cover letter (#416), written from the tailor window or here: Concise or Full, always
 * one page. The API keeps only the sentences its check grounds in the base résumé; this shows
 * the letter, what the check left out and what to look at, and lets each paragraph be edited
 * before the one Download.
 */

export interface WriteOptions {
  length: CoverLetterLength;
  confirmedKeywords: string[];
}

interface LetterError {
  message: string;
  code?: string;
  /** Write again: the AI failed. The retry uses the length and keywords as they are then. */
  retry?: boolean;
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
}

// A letter takes 10 to 30 seconds to write. Its state is kept here, per job, so a letter started
// in the tailor window, or before a switch to another tab, shows when this card is back.
const EMPTY: LetterState = { letter: undefined, loading: false, run: null, error: null, saving: false, downloading: false };
const states = new Map<string, LetterState>();
const listeners = new Set<() => void>();
/** Bumped by every change this page makes to a job's letter: a read started before it is stale. */
const generations = new Map<string, number>();

const stateOf = (jobId: string) => states.get(jobId) ?? EMPTY;

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
          retry: typeof status === 'number' && status >= 500,
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
  const [picked, setPicked] = useState<CoverLetterLength | null>(null);
  const { letter, run, error } = state;
  const length = picked ?? letter?.length ?? 'concise';

  useEffect(() => {
    loadCoverLetter(jobId);
  }, [jobId]);

  function write(options: WriteOptions = { length, confirmedKeywords: letter?.basedOn.confirmedKeywords ?? defaultKeywords }) {
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
          onLength={setPicked}
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
            <LengthToggle value={length} onChange={setPicked} />
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
                  if (error.retry) write();
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
  // The paragraph being edited, by its key: while one is open, nothing else can change the letter.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const keyOf = (index: number) => `${letter.id}:${index}:${letter.paragraphs[index]!.text}`;
  const editingOpen = editingKey !== null && letter.paragraphs.some((_paragraph, index) => keyOf(index) === editingKey);
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

  async function change(run: () => Promise<CoverLetterRecord>, failure: string): Promise<boolean> {
    setLetterState(jobId, { saving: true });
    try {
      setLetter(jobId, await run());
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : failure);
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
    );
    if (saved) setEditingKey(null);
    return saved;
  };
  const remove = (index: number) =>
    change(
      () => removeCoverLetterParagraph(jobId, index, letter.updatedAt, letter.paragraphs[index]!.text),
      "That paragraph couldn't be removed.",
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
          <Button onClick={download} disabled={locked}>
            {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Download PDF
          </Button>
        </div>
      </div>
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
            notes={letter.checks.filter((check) => !check.dropped && check.paragraph === index)}
            editing={editingKey === keyOf(index)}
            onEdit={() => setEditingKey(keyOf(index))}
            onCancel={() => setEditingKey(null)}
            busy={saving || downloading || (editingOpen && editingKey !== keyOf(index))}
            onSave={save}
            onRemove={letter.paragraphs.length > 1 ? remove : undefined}
          />
        ))}
      </div>

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

function ParagraphCard({
  index,
  paragraph,
  notes,
  editing,
  onEdit,
  onCancel,
  busy,
  onSave,
  onRemove,
}: {
  index: number;
  paragraph: CoverLetterParagraph;
  /** The check's marks on this paragraph's sentences; the user's own words have none. */
  notes: CoverLetterCheck[];
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  /** Saving, downloading, or another paragraph is open: nothing here can change. */
  busy: boolean;
  onSave: (index: number, text: string) => Promise<boolean>;
  /** Absent for a letter's only paragraph. */
  onRemove?: (index: number) => Promise<boolean>;
}) {
  const [text, setText] = useState(paragraph.text);
  const shownNotes = paragraph.edited ? [] : notes;

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`letter-paragraph-${index}`}>
      {paragraph.edited ? <p className="text-xs font-medium">Your words</p> : null}
      {editing ? (
        <Textarea aria-label={`Paragraph ${index + 1}`} value={text} onChange={(event) => setText(event.target.value)} rows={5} />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{paragraph.text}</p>
      )}
      {shownNotes.length > 0 ? (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          {shownNotes.flatMap((check, i) => [
            ...check.issues.map((issue, j) => <p key={`${i}-${j}`}>{`Check “${check.text}”: it ${issue.message}.`}</p>),
            ...(check.confirmedTerms?.length ? [<p key={`${i}-terms`}>{`Uses ${check.confirmedTerms.join(', ')}, which you added`}</p>] : []),
          ])}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" disabled={busy || !text.trim()} onClick={() => void onSave(index, text.trim())}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label={`Edit paragraph ${index + 1}`}
              onClick={() => {
                setText(paragraph.text);
                onEdit();
              }}
            >
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
