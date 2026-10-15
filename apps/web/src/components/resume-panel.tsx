'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { LocalDate } from '@/components/local-date';
import { MoveButtons, MoveMessage, useReorder } from '@/components/reorder';
import { ResumeImportConfirm } from '@/components/resume-import-confirm';
import { ResumeLayoutEditor } from '@/components/resume-layout-editor';
import { ResumePdfPreview } from '@/components/resume-pdf-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  errorMessage,
  fetchResumeText,
  parseResume,
  saveBaseResume,
  uploadResumeFile,
  type ResumeFlag,
  type ResumeSource,
} from '@/lib/api';
import { formatResumeDate, formatResumeRange, withEndDate } from '@/lib/resume-display';
import { moveItem } from '@/lib/resume-layout';
import type {
  ResumeBasics,
  ResumeCertificate,
  ResumeEducation,
  ResumeLocation,
  ResumeProfile,
  ResumeProject,
  ResumeSkill,
  ResumeWorkExperience,
  StructuredResume,
} from '@/types/job';

type SectionKey = 'basics' | 'work' | 'education' | 'skills' | 'projects' | 'certificates';

const SECTIONS: Array<{ key: SectionKey; title: string }> = [
  { key: 'basics', title: 'Basics' },
  { key: 'work', title: 'Experience' },
  { key: 'education', title: 'Education' },
  { key: 'skills', title: 'Skills' },
  { key: 'projects', title: 'Projects' },
  { key: 'certificates', title: 'Certificates' },
];

const titleOf = (key: SectionKey) => SECTIONS.find((section) => section.key === key)!.title;

const emptyResume = (): StructuredResume => ({
  basics: { name: '', email: '', summary: '' },
  work: [],
  education: [],
  skills: [],
  projects: [],
  certificates: [],
});

type SectionValue = StructuredResume[SectionKey];

const sectionOf = (resume: StructuredResume, key: SectionKey): SectionValue =>
  key === 'projects' || key === 'certificates' ? (resume[key] ?? []) : resume[key];

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const blank = (...values: Array<string | undefined>) => values.every((value) => !value?.trim());

// A bullet holds one line, and a skill one skill: a pasted list becomes one item each.
const LINE_BREAK = /\r?\n/;
const COMMA = ',';

/** Each item split at `separator`, trimmed, with the empty ones dropped. */
const splitLines = (items: string[], separator: RegExp | string) =>
  items.flatMap((item) => item.split(separator)).map((item) => item.trim()).filter(Boolean);

/** Drop the blank lines, and the items left empty, that editing leaves behind. */
function tidy(key: SectionKey, value: SectionValue): SectionValue {
  if (key === 'basics') {
    const basics = value as ResumeBasics;
    return basics.profiles ? { ...basics, profiles: basics.profiles.filter((link) => !blank(link.network, link.url)) } : basics;
  }
  if (key === 'work') {
    return (value as ResumeWorkExperience[])
      .map((role) => ({ ...role, highlights: splitLines(role.highlights, LINE_BREAK) }))
      .filter(
        (role) => !blank(role.company, role.position, role.startDate, role.endDate, role.location, role.summary) || role.highlights.length > 0,
      );
  }
  if (key === 'skills') {
    return (value as ResumeSkill[])
      .map((group) => ({ ...group, skills: splitLines(group.skills, COMMA) }))
      .filter((group) => !blank(group.category) || group.skills.length > 0);
  }
  if (key === 'education') {
    return (value as ResumeEducation[])
      .map((entry) => (entry.highlights ? { ...entry, highlights: splitLines(entry.highlights, LINE_BREAK) } : entry))
      .filter(
        (entry) =>
          !blank(entry.institution, entry.studyType, entry.area, entry.startDate, entry.endDate, entry.gpa) ||
          (entry.highlights?.length ?? 0) > 0,
      );
  }
  if (key === 'projects') {
    return (value as ResumeProject[])
      .map((project) => ({
        ...project,
        ...(project.highlights ? { highlights: splitLines(project.highlights, LINE_BREAK) } : {}),
        ...(project.keywords ? { keywords: splitLines(project.keywords, COMMA) } : {}),
      }))
      .filter(
        (project) =>
          !blank(project.name, project.url, project.description) ||
          (project.highlights?.length ?? 0) > 0 ||
          (project.keywords?.length ?? 0) > 0,
      );
  }
  if (key === 'certificates') {
    return (value as ResumeCertificate[]).filter((certificate) => !blank(certificate.name, certificate.issuer, certificate.date, certificate.url));
  }
  return value;
}

type ImportState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'error'; title: string; message: string; retry?: () => void }
  | {
      kind: 'confirming';
      parsed: StructuredResume;
      flags: ResumeFlag[];
      saving: boolean;
      error: string | null;
      /** A new file's text, stored with the résumé on "Looks right". */
      staged: ResumeSource | null;
    };

type Pending =
  | { kind: 'switch'; key: SectionKey }
  | { kind: 'replace' }
  | { kind: 'read' }
  | { kind: 'retry'; run: () => void };

interface ResumePanelProps {
  initial: StructuredResume | null;
  updatedAt: string | null;
  resumeFileName: string | null;
  /** A résumé's text is on file, so it can be read without a new upload. */
  hasStoredText: boolean;
  /** Why the résumé couldn't be loaded. Then nothing is editable: a save would overwrite it. */
  loadError?: string | null;
}

/**
 * The résumé in Settings (#350): it reads like a résumé, and each section has its own Edit,
 * with Save and Cancel inside the section. "Replace from file…" reads a new PDF and shows
 * what it found for confirmation; nothing is saved until the user says it looks right.
 * It replaces a 3,500 px wall of inputs whose only Save sat at the bottom, whose placeholders
 * looked like real data, and whose re-import overwrote edits without asking.
 */
export function ResumePanel({ initial, updatedAt, resumeFileName, hasStoredText, loadError }: ResumePanelProps) {
  const router = useRouter();
  const [saved, setSaved] = useState<StructuredResume>(() => initial ?? emptyResume());
  const [hasResume, setHasResume] = useState(initial !== null);
  const [lastUpdated, setLastUpdated] = useState(updatedAt);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState<SectionValue | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  const [fileName, setFileName] = useState(resumeFileName);
  const [textOnFile, setTextOnFile] = useState(hasStoredText);
  const [readText, setReadText] = useState<string | null>(null);
  const [readTextError, setReadTextError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Each edit session has its own number, so an Undo from a closed section changes nothing.
  const session = useRef(0);
  // The Undo toasts of the open section, dismissed when it closes.
  const undoToasts = useRef<Array<string | number>>([]);
  // A section save is on its way: an Undo now would change a draft that was already sent.
  const savingRef = useRef(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  // Layout changes save on their own (#415); a résumé save waits for them, so the two can't cross.
  const layoutSaves = useRef<Promise<void>>(Promise.resolve());
  // Goes up with every save: a PDF preview made before it is out of date.
  const [changes, setChanges] = useState(0);

  const dirty =
    editing !== null &&
    draft !== null &&
    JSON.stringify(tidy(editing, draft)) !== JSON.stringify(sectionOf(saved, editing));
  // A résumé is saved whole, and the API needs a name on it.
  const nameMissing =
    editing === 'basics' ? !(draft as ResumeBasics | null)?.name.trim() : !saved.basics.name.trim();

  // The discard question can open far from the button that raised it: bring it to the user.
  useEffect(() => {
    if (!pending) return;
    keepEditingRef.current?.scrollIntoView?.({ block: 'center' });
    keepEditingRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** End the open section's Undos: dismiss their toasts, and make a late click change nothing. */
  function dismissUndos() {
    for (const id of undoToasts.current) toast.dismiss(id);
    undoToasts.current = [];
    session.current += 1;
  }

  function open(key: SectionKey) {
    dismissUndos();
    setEditing(key);
    setDraft(copy(sectionOf(saved, key)));
    setPending(null);
    setSectionError(null);
  }

  function close() {
    dismissUndos();
    setEditing(null);
    setDraft(null);
    setPending(null);
    setSectionError(null);
  }

  function startEdit(key: SectionKey) {
    if (dirty && key !== editing) setPending({ kind: 'switch', key });
    else open(key);
  }

  function requestReplace() {
    if (dirty) setPending({ kind: 'replace' });
    else fileRef.current?.click();
  }

  function requestRead() {
    if (dirty) setPending({ kind: 'read' });
    else void read();
  }

  /** "Try again" on a failed import: read again, or pick a file again when it had none. */
  function requestRetry(run?: () => void) {
    if (!run) requestReplace();
    else if (dirty) setPending({ kind: 'retry', run });
    else run();
  }

  function discardAndContinue() {
    if (pending?.kind === 'switch') {
      open(pending.key);
      return;
    }
    const next = pending;
    close();
    if (next?.kind === 'read') void read();
    else if (next?.kind === 'retry') next.run();
    else fileRef.current?.click();
  }

  async function saveSection() {
    if (!editing || draft === null) return;
    const next = { ...saved, [editing]: tidy(editing, draft) } as StructuredResume;
    if (!next.basics.name.trim()) {
      setSectionError(editing === 'basics' ? 'Add your name.' : 'Add your name in Basics first. The résumé is saved as a whole.');
      return;
    }
    // The section is frozen until the save answers (and Undo waits): a change made meanwhile
    // would be lost when it closes.
    savingRef.current = true;
    setSaving(true);
    setSectionError(null);
    try {
      await layoutSaves.current;
      const result = await saveBaseResume(next);
      setSaved(result ?? next);
      setHasResume(true);
      setLastUpdated(new Date().toISOString());
      setChanges((count) => count + 1);
      close();
      toast.success(`${titleOf(editing)} saved.`);
      router.refresh();
    } catch (error) {
      setSectionError(errorMessage(error, 'Could not save. Try again.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /** Remove an item from the section being edited, with 5 seconds to undo. */
  function removeItem(index: number, label: string) {
    const list = draft as unknown[];
    const item = list[index];
    const at = session.current;
    setDraft(list.filter((_, i) => i !== index) as SectionValue);
    const id = toast(`Removed ${label}.`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: (event) => {
          if (session.current !== at) return;
          // Kept for after the save: it closes the section if it works, and leaves it open if not.
          if (savingRef.current) {
            event.preventDefault();
            return;
          }
          setDraft((current) => {
            const items = [...((current as unknown[]) ?? [])];
            items.splice(Math.min(index, items.length), 0, item);
            return items as SectionValue;
          });
        },
      },
    });
    if (id !== undefined) undoToasts.current.push(id);
  }

  async function read(text?: string, staged: ResumeSource | null = null) {
    // An open section would be replaced by the import: close it (a changed one was asked about).
    close();
    setImportState({ kind: 'reading' });
    try {
      const { structuredResume, flags } = await parseResume(text);
      setImportState({ kind: 'confirming', parsed: structuredResume, flags, saving: false, error: null, staged });
    } catch (error) {
      setImportState({
        kind: 'error',
        title: "Couldn't read your résumé",
        message: errorMessage(error, 'The AI could not read it. Try again in a moment.'),
        retry: () => void read(text, staged),
      });
    }
  }

  async function onFile(file: File) {
    close();
    setImportState({ kind: 'reading' });
    try {
      // Only read: the file replaces the stored one when the user confirms (#350).
      const { resumeText, resumeFileName: name } = await uploadResumeFile(file, { preview: true });
      await read(resumeText ?? undefined, { text: resumeText ?? '', fileName: name ?? file.name });
    } catch (error) {
      setImportState({
        kind: 'error',
        title: "Couldn't read that file",
        message: errorMessage(error, 'Try another PDF.'),
      });
    }
  }

  async function confirmImport(resume: StructuredResume) {
    if (importState.kind !== 'confirming') return;
    setImportState({ ...importState, saving: true, error: null });
    try {
      // A new file's text is saved with the résumé read from it, in one request, so the stored
      // text can't change without the résumé.
      const { staged } = importState;
      await layoutSaves.current;
      // The API keeps the saved layout: the résumé read from a file has none (#415).
      const result = await saveBaseResume(resume, staged);
      if (staged) {
        setFileName(staged.fileName);
        setTextOnFile(true);
        setReadText(staged.text);
      }
      // An editor left open holds the old section; its Save would undo the import.
      close();
      setSaved(result ?? resume);
      setHasResume(true);
      setLastUpdated(new Date().toISOString());
      setChanges((count) => count + 1);
      setImportState({ kind: 'idle' });
      toast.success('Résumé saved.');
      router.refresh();
    } catch (error) {
      setImportState({ ...importState, saving: false, error: errorMessage(error, 'Could not save. Try again.') });
    }
  }

  async function loadReadText() {
    if (readText !== null) return;
    setReadTextError(null);
    try {
      const { resumeText } = await fetchResumeText();
      // A replacement saved while this was loading has the newer text.
      setReadText((current) => current ?? resumeText ?? '');
    } catch (error) {
      setReadTextError(errorMessage(error, "Couldn't load the text."));
    }
  }

  const importSaving = importState.kind === 'confirming' && importState.saving;
  const busy = saving || importState.kind === 'reading' || importSaving;

  if (loadError) {
    return <ErrorState title="Couldn't load your résumé" message={loadError} />;
  }

  return (
    <div className="space-y-5" data-testid="resume-panel">
      {/* The file */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-sm font-medium">Résumé file</p>
          <p className="text-muted-foreground truncate text-xs">{fileName ?? 'No file yet'}</p>
        </div>
        {!hasResume && textOnFile ? (
          <Button size="sm" disabled={busy} onClick={requestRead}>
            Read my résumé
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={busy} onClick={requestReplace}>
          {fileName ? 'Replace from file…' : 'Upload a PDF…'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          aria-label="Résumé PDF"
          className="sr-only"
          // It can still be reached by keyboard: a file read now would close a section being saved.
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onFile(file);
          }}
        />
      </div>

      {textOnFile ? (
        <details
          className="text-sm"
          onToggle={(event) => {
            if ((event.currentTarget as HTMLDetailsElement).open) void loadReadText();
          }}
        >
          <summary className="text-muted-foreground cursor-pointer select-none text-xs">
            What we read from your PDF
          </summary>
          {readText !== null ? (
            <pre className="bg-muted/40 mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md p-3 font-sans text-xs">
              {readText || 'No text was read.'}
            </pre>
          ) : readTextError ? (
            <p className="text-destructive mt-2 text-xs">{readTextError}</p>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">Loading…</p>
          )}
        </details>
      ) : null}

      {importState.kind === 'reading' ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading your résumé…
        </p>
      ) : null}
      {importState.kind === 'error' ? (
        <ErrorState
          title={importState.title}
          message={importState.message}
          onRetry={() => requestRetry(importState.retry)}
          retryDisabled={busy}
        />
      ) : null}
      {importState.kind === 'confirming' ? (
        <ResumeImportConfirm
          parsed={importState.parsed}
          flags={importState.flags}
          saving={importState.saving}
          error={importState.error}
          onConfirm={(resume) => void confirmImport(resume)}
          onCancel={() => setImportState({ kind: 'idle' })}
        />
      ) : null}

      {lastUpdated ? (
        <p className="text-muted-foreground text-xs">
          Last updated <LocalDate value={lastUpdated} />
        </p>
      ) : null}

      <div className="divide-y border-t">
        {SECTIONS.map(({ key, title }) => {
          const isEditing = editing === key && draft !== null;
          return (
            <section key={key} aria-labelledby={`resume-${key}-title`} className="space-y-3 py-4">
              <div className="flex items-center justify-between gap-2">
                <h3 id={`resume-${key}-title`} className="text-sm font-semibold">
                  {title}
                </h3>
                {!isEditing ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(key)}
                    aria-label={`Edit ${title}`}
                    // An import being read or checked would replace the section and drop the edit;
                    // a section being saved closes when it's done.
                    disabled={saving || importState.kind === 'reading' || importState.kind === 'confirming'}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>

              {isEditing ? (
                // Disabled while it saves, so nothing changes after the snapshot that was sent.
                <fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-4">
                  <SectionEditor
                    sectionKey={key}
                    value={draft}
                    onChange={(value) => setDraft(value)}
                    onRemove={removeItem}
                  />
                  {pending ? (
                    <div role="alertdialog" aria-labelledby={`resume-${key}-discard`} className="bg-muted/50 space-y-2 rounded-md p-3">
                      <p id={`resume-${key}-discard`} className="text-sm">
                        {pending.kind === 'replace'
                          ? `Replacing from file will discard your changes to ${title}.`
                          : pending.kind === 'read'
                            ? `Reading your résumé will discard your changes to ${title}.`
                            : pending.kind === 'retry'
                              ? `Trying again will discard your changes to ${title}.`
                              : `Discard your changes to ${title}?`}
                      </p>
                      <div className="flex gap-2">
                        <Button ref={keepEditingRef} size="sm" variant="outline" onClick={() => setPending(null)}>
                          Keep editing
                        </Button>
                        <Button size="sm" variant="ghost" onClick={discardAndContinue}>
                          {pending.kind === 'replace'
                            ? 'Discard and replace'
                            : pending.kind === 'read'
                              ? 'Discard and read'
                              : pending.kind === 'retry'
                                ? 'Discard and try again'
                                : 'Discard'}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {sectionError ? (
                    <p role="alert" className="text-destructive text-sm">
                      {sectionError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveSection()} disabled={saving || !dirty || (key === 'basics' && nameMissing)}>
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </fieldset>
              ) : (
                <SectionView sectionKey={key} resume={saved} />
              )}
            </section>
          );
        })}
      </div>

      <div className="space-y-5 border-t pt-4">
        <ResumeLayoutEditor
          initial={initial?.layout}
          // While a résumé save is on its way, so a layout change can't cross it.
          disabled={!hasResume || saving || importSaving}
          onPending={(settled) => (layoutSaves.current = settled)}
          onSaved={(layout) => {
            setSaved((current) => ({ ...current, layout }));
            setChanges((count) => count + 1);
          }}
        />
        <ResumePdfPreview name={saved.basics.name} disabled={!hasResume} changes={changes} />
      </div>
    </div>
  );
}

const NotSet = () => <p className="text-muted-foreground text-sm">Not set</p>;

/** "Austin, TX, US", as the PDF prints a location. */
const placeOf = (location: ResumeLocation | undefined) =>
  [location?.city, location?.region, location?.countryCode].filter((part) => part?.trim()).join(', ');

/** Bullets as the PDF prints them. */
function Bullets({ lines }: { lines: string[] | undefined }) {
  if (!lines?.length) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

function SectionView({ sectionKey, resume }: { sectionKey: SectionKey; resume: StructuredResume }) {
  if (sectionKey === 'basics') {
    const { name, label, email, phone, summary, location, url, profiles } = resume.basics;
    const contact = [email, phone, placeOf(location), url, ...(profiles ?? []).map((link) => link.url)]
      .filter((part) => part?.trim())
      .join(' · ');
    if (!name.trim() && !label?.trim() && !contact && !summary.trim()) return <NotSet />;
    return (
      <div className="space-y-1 text-sm">
        {name.trim() ? <p className="font-medium">{name}</p> : null}
        {label?.trim() ? <p>{label}</p> : null}
        {contact ? <p className="text-muted-foreground break-words">{contact}</p> : null}
        {summary.trim() ? <p className="pt-1">{summary}</p> : null}
      </div>
    );
  }
  if (sectionKey === 'work') {
    if (resume.work.length === 0) return <NotSet />;
    return (
      <ol className="divide-y">
        {resume.work.map((role, index) => {
          const dates = formatResumeRange(role.startDate, role.endDate, role.current);
          return (
            <li key={index} className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
              <p className="font-medium">{role.position.trim() || 'No title'}</p>
              <p className="text-muted-foreground">{[role.company.trim() || 'No company', dates].filter(Boolean).join(' · ')}</p>
              {role.location?.trim() ? <p className="text-muted-foreground">{role.location}</p> : null}
              {role.summary?.trim() ? <p>{role.summary}</p> : null}
              <Bullets lines={role.highlights} />
            </li>
          );
        })}
      </ol>
    );
  }
  if (sectionKey === 'education') {
    if (resume.education.length === 0) return <NotSet />;
    return (
      <ol className="divide-y">
        {resume.education.map((entry, index) => {
          const degree = [entry.studyType, entry.area].filter((part) => part?.trim()).join(', ');
          const dates = formatResumeRange(entry.startDate, entry.endDate);
          const detail = [degree, dates, entry.gpa?.trim() ? `GPA ${entry.gpa.trim()}` : ''].filter(Boolean).join(' · ');
          return (
            <li key={index} className="space-y-0.5 py-3 text-sm first:pt-0 last:pb-0">
              <p className="font-medium">{entry.institution.trim() || 'No school'}</p>
              {detail ? <p className="text-muted-foreground">{detail}</p> : null}
              <Bullets lines={entry.highlights} />
            </li>
          );
        })}
      </ol>
    );
  }
  if (sectionKey === 'skills') {
    if (resume.skills.length === 0) return <NotSet />;
    return (
      <ul className="space-y-1 text-sm">
        {resume.skills.map((group, index) => (
          <li key={index}>
            {group.category.trim() ? <span className="font-medium">{group.category}: </span> : null}
            {group.skills.join(', ')}
          </li>
        ))}
      </ul>
    );
  }
  if (sectionKey === 'projects') {
    const projects = resume.projects ?? [];
    if (projects.length === 0) return <NotSet />;
    return (
      <ol className="divide-y">
        {projects.map((project, index) => (
          <li key={index} className="space-y-0.5 py-3 text-sm first:pt-0 last:pb-0">
            <p className="font-medium">{project.name.trim() || 'Untitled project'}</p>
            {project.keywords?.length ? <p className="text-muted-foreground">{project.keywords.join(', ')}</p> : null}
            {project.url?.trim() ? <p className="text-muted-foreground break-all">{project.url}</p> : null}
            {project.description?.trim() ? <p>{project.description}</p> : null}
            <Bullets lines={project.highlights} />
          </li>
        ))}
      </ol>
    );
  }
  const certificates = resume.certificates ?? [];
  if (certificates.length === 0) return <NotSet />;
  return (
    <ul className="space-y-1 text-sm">
      {certificates.map((certificate, index) => (
        <li key={index}>
          <span className="font-medium">{certificate.name}</span>
          {[certificate.issuer, formatResumeDate(certificate.date)].filter((part) => part?.trim()).map((part) => ` · ${part}`)}
          {certificate.url?.trim() ? <span className="text-muted-foreground block break-all">{certificate.url}</span> : null}
        </li>
      ))}
    </ul>
  );
}

interface EditorProps {
  sectionKey: SectionKey;
  value: SectionValue;
  onChange: (value: SectionValue) => void;
  onRemove: (index: number, label: string) => void;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function SectionEditor({ sectionKey, value, onChange, onRemove }: EditorProps) {
  if (sectionKey === 'basics') {
    const basics = value as ResumeBasics;
    const set = (field: keyof ResumeBasics, text: string) => onChange({ ...basics, [field]: text });
    const setPlace = (field: keyof ResumeLocation, text: string) => onChange({ ...basics, location: { ...basics.location, [field]: text } });
    const links = basics.profiles ?? [];
    const setLinks = (next: ResumeProfile[]) => onChange({ ...basics, profiles: next });
    const setLink = (index: number, field: keyof ResumeProfile, text: string) =>
      setLinks(links.map((link, i) => (i === index ? { ...link, [field]: text } : link)));
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="resume-basics-name" label="Name">
            <Input id="resume-basics-name" value={basics.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="resume-basics-label" label="Title">
            <Input id="resume-basics-label" value={basics.label ?? ''} onChange={(e) => set('label', e.target.value)} />
          </Field>
          <Field id="resume-basics-email" label="Email">
            <Input id="resume-basics-email" type="email" value={basics.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="resume-basics-phone" label="Phone">
            <Input id="resume-basics-phone" value={basics.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field id="resume-basics-city" label="City">
            <Input id="resume-basics-city" value={basics.location?.city ?? ''} onChange={(e) => setPlace('city', e.target.value)} />
          </Field>
          <Field id="resume-basics-region" label="State or region">
            <Input id="resume-basics-region" value={basics.location?.region ?? ''} onChange={(e) => setPlace('region', e.target.value)} />
          </Field>
          <Field id="resume-basics-country" label="Country">
            <Input
              id="resume-basics-country"
              value={basics.location?.countryCode ?? ''}
              onChange={(e) => setPlace('countryCode', e.target.value)}
            />
          </Field>
          <Field id="resume-basics-url" label="Website">
            <Input id="resume-basics-url" type="url" value={basics.url ?? ''} onChange={(e) => set('url', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="resume-basics-summary" label="Summary">
              <Textarea id="resume-basics-summary" rows={3} value={basics.summary} onChange={(e) => set('summary', e.target.value)} />
            </Field>
          </div>
        </div>
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">Links</legend>
          <p className="text-muted-foreground text-xs">Printed on the contact line, in this order: LinkedIn, GitHub, a portfolio.</p>
          <ItemList
            items={links}
            addLabel="Add a link"
            onAdd={() => setLinks([...links, { network: '', url: '' }])}
            onMove={(from, to) => setLinks(moveItem(links, from, to))}
            render={(link, index) => (
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                <Field id={`resume-basics-profiles-${index}-network`} label="Site">
                  <Input
                    id={`resume-basics-profiles-${index}-network`}
                    value={link.network}
                    onChange={(e) => setLink(index, 'network', e.target.value)}
                  />
                </Field>
                <Field id={`resume-basics-profiles-${index}-url`} label="URL">
                  <Input
                    id={`resume-basics-profiles-${index}-url`}
                    type="url"
                    value={link.url}
                    onChange={(e) => setLink(index, 'url', e.target.value)}
                  />
                </Field>
              </div>
            )}
            itemLabel={(link, index) => link.network.trim() || `link ${index + 1}`}
            onRemove={(index) => setLinks(links.filter((_, i) => i !== index))}
          />
        </fieldset>
      </div>
    );
  }

  if (sectionKey === 'work') {
    const roles = value as ResumeWorkExperience[];
    const set = (index: number, field: keyof ResumeWorkExperience, next: unknown) =>
      onChange(roles.map((role, i) => (i === index ? { ...role, [field]: next } : role)));
    return (
      <ItemList
        items={roles}
        addLabel="Add a role"
        onAdd={() => onChange([...roles, { company: '', position: '', startDate: '', highlights: [] }])}
        onMove={(from, to) => onChange(moveItem(roles, from, to))}
        render={(role, index) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`resume-work-${index}-company`} label="Company">
                <Input id={`resume-work-${index}-company`} value={role.company} onChange={(e) => set(index, 'company', e.target.value)} />
              </Field>
              <Field id={`resume-work-${index}-position`} label="Title">
                <Input id={`resume-work-${index}-position`} value={role.position} onChange={(e) => set(index, 'position', e.target.value)} />
              </Field>
              <Field id={`resume-work-${index}-start`} label="Start">
                <Input id={`resume-work-${index}-start`} value={role.startDate} placeholder="e.g. 2024-06" onChange={(e) => set(index, 'startDate', e.target.value)} />
              </Field>
              <Field id={`resume-work-${index}-end`} label="End">
                <Input
                  id={`resume-work-${index}-end`}
                  value={role.endDate ?? ''}
                  placeholder="Leave empty if current"
                  onChange={(e) => onChange(roles.map((item, i) => (i === index ? withEndDate(item, e.target.value) : item)))}
                />
              </Field>
              <Field id={`resume-work-${index}-location`} label="Location">
                <Input id={`resume-work-${index}-location`} value={role.location ?? ''} onChange={(e) => set(index, 'location', e.target.value)} />
              </Field>
            </div>
            <Field id={`resume-work-${index}-summary`} label="Summary (optional)">
              <Textarea
                id={`resume-work-${index}-summary`}
                rows={2}
                value={role.summary ?? ''}
                onChange={(e) => set(index, 'summary', e.target.value)}
              />
            </Field>
            <LineList
              idPrefix={`resume-work-${index}-highlights`}
              legend="Bullets"
              noun="bullet"
              lines={role.highlights}
              separator={LINE_BREAK}
              multiline
              onChange={(lines) => set(index, 'highlights', lines)}
            />
          </>
        )}
        itemLabel={(role) => role.company.trim() || role.position.trim() || 'this role'}
        onRemove={onRemove}
      />
    );
  }

  if (sectionKey === 'education') {
    const entries = value as ResumeEducation[];
    const set = (index: number, field: keyof ResumeEducation, next: string | string[]) =>
      onChange(entries.map((entry, i) => (i === index ? { ...entry, [field]: next } : entry)));
    return (
      <ItemList
        items={entries}
        addLabel="Add education"
        onAdd={() => onChange([...entries, { institution: '' }])}
        onMove={(from, to) => onChange(moveItem(entries, from, to))}
        render={(entry, index) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`resume-education-${index}-institution`} label="School">
                <Input id={`resume-education-${index}-institution`} value={entry.institution} onChange={(e) => set(index, 'institution', e.target.value)} />
              </Field>
              <Field id={`resume-education-${index}-degree`} label="Degree">
                <Input id={`resume-education-${index}-degree`} value={entry.studyType ?? ''} onChange={(e) => set(index, 'studyType', e.target.value)} />
              </Field>
              <Field id={`resume-education-${index}-area`} label="Field of study">
                <Input id={`resume-education-${index}-area`} value={entry.area ?? ''} onChange={(e) => set(index, 'area', e.target.value)} />
              </Field>
              <Field id={`resume-education-${index}-gpa`} label="GPA">
                <Input id={`resume-education-${index}-gpa`} value={entry.gpa ?? ''} onChange={(e) => set(index, 'gpa', e.target.value)} />
              </Field>
              <Field id={`resume-education-${index}-start`} label="Start">
                <Input id={`resume-education-${index}-start`} value={entry.startDate ?? ''} placeholder="e.g. 2024-06" onChange={(e) => set(index, 'startDate', e.target.value)} />
              </Field>
              <Field id={`resume-education-${index}-end`} label="End">
                <Input id={`resume-education-${index}-end`} value={entry.endDate ?? ''} placeholder="e.g. 2024-06" onChange={(e) => set(index, 'endDate', e.target.value)} />
              </Field>
            </div>
            <LineList
              idPrefix={`resume-education-${index}-highlights`}
              legend="Bullets"
              noun="bullet"
              lines={entry.highlights ?? []}
              separator={LINE_BREAK}
              multiline
              onChange={(lines) => set(index, 'highlights', lines)}
            />
          </>
        )}
        itemLabel={(entry) => entry.institution.trim() || 'this entry'}
        onRemove={onRemove}
      />
    );
  }

  if (sectionKey === 'skills') {
    const groups = value as ResumeSkill[];
    const set = (index: number, next: ResumeSkill) => onChange(groups.map((group, i) => (i === index ? next : group)));
    return (
      <ItemList
        items={groups}
        addLabel="Add a skill group"
        onAdd={() => onChange([...groups, { category: '', skills: [] }])}
        onMove={(from, to) => onChange(moveItem(groups, from, to))}
        render={(group, index) => (
          <div className="space-y-3">
            <Field id={`resume-skills-${index}-category`} label="Group">
              <Input id={`resume-skills-${index}-category`} value={group.category} onChange={(e) => set(index, { ...group, category: e.target.value })} />
            </Field>
            <LineList
              idPrefix={`resume-skills-${index}-skills`}
              legend="Skills"
              noun="skill"
              lines={group.skills}
              separator={COMMA}
              onChange={(skills) => set(index, { ...group, skills })}
            />
          </div>
        )}
        itemLabel={(group) => group.category.trim() || 'this group'}
        onRemove={onRemove}
      />
    );
  }

  if (sectionKey === 'projects') {
    const projects = value as ResumeProject[];
    const set = (index: number, field: keyof ResumeProject, next: string | string[]) =>
      onChange(projects.map((project, i) => (i === index ? { ...project, [field]: next } : project)));
    return (
      <ItemList
        items={projects}
        addLabel="Add a project"
        onAdd={() => onChange([...projects, { name: '' }])}
        onMove={(from, to) => onChange(moveItem(projects, from, to))}
        render={(project, index) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`resume-projects-${index}-name`} label="Name">
                <Input id={`resume-projects-${index}-name`} value={project.name} onChange={(e) => set(index, 'name', e.target.value)} />
              </Field>
              <Field id={`resume-projects-${index}-url`} label="Link">
                <Input id={`resume-projects-${index}-url`} value={project.url ?? ''} onChange={(e) => set(index, 'url', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field id={`resume-projects-${index}-keywords`} label="Keywords, separated by commas">
                  <Input
                    id={`resume-projects-${index}-keywords`}
                    value={(project.keywords ?? []).join(', ')}
                    onChange={(e) => set(index, 'keywords', e.target.value.split(',').map((keyword) => keyword.trimStart()))}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field id={`resume-projects-${index}-description`} label="Description">
                  <Textarea id={`resume-projects-${index}-description`} rows={2} value={project.description ?? ''} onChange={(e) => set(index, 'description', e.target.value)} />
                </Field>
              </div>
            </div>
            <LineList
              idPrefix={`resume-projects-${index}-highlights`}
              legend="Bullets"
              noun="bullet"
              lines={project.highlights ?? []}
              separator={LINE_BREAK}
              multiline
              onChange={(lines) => set(index, 'highlights', lines)}
            />
          </>
        )}
        itemLabel={(project) => project.name.trim() || 'this project'}
        onRemove={onRemove}
      />
    );
  }

  const certificates = value as ResumeCertificate[];
  const set = (index: number, field: keyof ResumeCertificate, text: string) =>
    onChange(certificates.map((certificate, i) => (i === index ? { ...certificate, [field]: text } : certificate)));
  return (
    <ItemList
      items={certificates}
      addLabel="Add a certificate"
      onAdd={() => onChange([...certificates, { name: '', issuer: '' }])}
      onMove={(from, to) => onChange(moveItem(certificates, from, to))}
      render={(certificate, index) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`resume-certificates-${index}-name`} label="Name">
            <Input id={`resume-certificates-${index}-name`} value={certificate.name} onChange={(e) => set(index, 'name', e.target.value)} />
          </Field>
          <Field id={`resume-certificates-${index}-issuer`} label="Issuer">
            <Input id={`resume-certificates-${index}-issuer`} value={certificate.issuer} onChange={(e) => set(index, 'issuer', e.target.value)} />
          </Field>
          <Field id={`resume-certificates-${index}-date`} label="Date">
            <Input id={`resume-certificates-${index}-date`} value={certificate.date ?? ''} placeholder="e.g. 2024-06" onChange={(e) => set(index, 'date', e.target.value)} />
          </Field>
          <Field id={`resume-certificates-${index}-url`} label="Link">
            <Input id={`resume-certificates-${index}-url`} value={certificate.url ?? ''} onChange={(e) => set(index, 'url', e.target.value)} />
          </Field>
        </div>
      )}
      itemLabel={(certificate) => certificate.name.trim() || 'this certificate'}
      onRemove={onRemove}
    />
  );
}

interface ItemListProps<T> {
  items: T[];
  addLabel: string;
  onAdd: () => void;
  /** Move the item at `from` to `to`. */
  onMove: (from: number, to: number) => void;
  render: (item: T, index: number) => ReactNode;
  itemLabel: (item: T, index: number) => string;
  onRemove: (index: number, label: string) => void;
}

/**
 * Items separated by dividers, each with Move up, Move down (#415) and a plain Remove, and one
 * Add below.
 */
function ItemList<T>({ items, addLabel, onAdd, onMove, render, itemLabel, onRemove }: ItemListProps<T>) {
  const { container, message, move: moveAndSay } = useReorder();
  return (
    <div ref={container} className="space-y-3">
      <ol className="divide-y">
        {items.map((item, index) => {
          const label = itemLabel(item, index);
          return (
            <li key={index} className="space-y-3 py-3 first:pt-0">
              {render(item, index)}
              <div className="flex justify-end gap-1">
                <MoveButtons
                  index={index}
                  count={items.length}
                  label={label}
                  onMove={(to, direction) => moveAndSay(() => onMove(index, to), label, to, items.length, direction)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  aria-label={`Remove ${label}`}
                  onClick={() => onRemove(index, label)}
                >
                  Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="outline" size="sm" onClick={onAdd}>
        {addLabel}
      </Button>
      <MoveMessage message={message} />
    </div>
  );
}

interface LineListProps {
  idPrefix: string;
  /** "Bullets", "Skills". */
  legend: string;
  /** "bullet", "skill": "Bullet 2", "Move bullet 2 up", "Add a bullet". */
  noun: string;
  lines: string[];
  /** What splits a pasted list into lines: a line break for bullets, a comma for skills. */
  separator: RegExp | string;
  multiline?: boolean;
  onChange: (lines: string[]) => void;
}

/** One field per line (a bullet, a skill), each with Move up, Move down and Remove (#415). */
function LineList({ idPrefix, legend, noun, lines, separator, multiline = false, onChange }: LineListProps) {
  const { container, message, move: moveAndSay } = useReorder();
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const set = (index: number, text: string) => onChange(lines.map((line, i) => (i === index ? text : line)));
  // A pasted list is split when the field is left; a lone blank line stays until the save.
  const split = (index: number) => {
    const parts = lines[index]!.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) onChange([...lines.slice(0, index), ...parts, ...lines.slice(index + 1)]);
  };
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div ref={container} className="space-y-2">
        {lines.length > 0 ? (
          <ol className="space-y-2">
            {lines.map((line, index) => {
              const id = `${idPrefix}-${index}`;
              return (
                <li key={index} className={`flex items-start gap-1 ${multiline ? 'flex-wrap sm:flex-nowrap' : ''}`}>
                  <Label htmlFor={id} className="sr-only">
                    {`${Noun} ${index + 1}`}
                  </Label>
                  {multiline ? (
                    <Textarea
                      id={id}
                      rows={2}
                      className="min-h-0 min-w-0 basis-full sm:basis-0 sm:flex-1"
                      value={line}
                      onChange={(e) => set(index, e.target.value)}
                      onBlur={() => split(index)}
                    />
                  ) : (
                    <Input id={id} className="min-w-0 flex-1" value={line} onChange={(e) => set(index, e.target.value)} onBlur={() => split(index)} />
                  )}
                  <div className="ml-auto flex shrink-0 gap-1">
                    <MoveButtons
                      index={index}
                      count={lines.length}
                      label={`${noun} ${index + 1}`}
                      onMove={(to, direction) => moveAndSay(() => onChange(moveItem(lines, index, to)), Noun, to, lines.length, direction)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${noun} ${index + 1}`}
                      title="Remove"
                      onClick={() => onChange(lines.filter((_, i) => i !== index))}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, ''])}>
          {`Add a ${noun}`}
        </Button>
        <MoveMessage message={message} />
      </div>
    </fieldset>
  );
}
