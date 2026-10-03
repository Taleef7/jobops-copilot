'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { ResumeImportConfirm } from '@/components/resume-import-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useHydrated } from '@/hooks/use-hydrated';
import {
  errorMessage,
  fetchResumeText,
  parseResume,
  saveBaseResume,
  uploadResumeFile,
  type ResumeFlag,
  type ResumeSource,
} from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatResumeDate, formatResumeRange, withEndDate } from '@/lib/resume-display';
import type {
  ResumeBasics,
  ResumeCertificate,
  ResumeEducation,
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

/** Drop the blank lines, and the items left empty, that editing leaves behind. */
function tidy(key: SectionKey, value: SectionValue): SectionValue {
  if (key === 'work') {
    return (value as ResumeWorkExperience[])
      .map((role) => ({ ...role, highlights: role.highlights.map((line) => line.trim()).filter(Boolean) }))
      .filter((role) => !blank(role.company, role.position, role.startDate, role.endDate, role.location) || role.highlights.length > 0);
  }
  if (key === 'skills') {
    return (value as ResumeSkill[])
      .map((group) => ({ ...group, skills: group.skills.map((skill) => skill.trim()).filter(Boolean) }))
      .filter((group) => !blank(group.category) || group.skills.length > 0);
  }
  if (key === 'education') {
    return (value as ResumeEducation[]).filter((entry) => !blank(entry.institution, entry.studyType, entry.area, entry.endDate));
  }
  if (key === 'projects') {
    return (value as ResumeProject[]).filter((project) => !blank(project.name, project.url, project.description));
  }
  if (key === 'certificates') {
    return (value as ResumeCertificate[]).filter((certificate) => !blank(certificate.name, certificate.issuer, certificate.date));
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
      const result = await saveBaseResume(next);
      setSaved(result ?? next);
      setHasResume(true);
      setLastUpdated(new Date().toISOString());
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

  const busy = saving || importState.kind === 'reading' || (importState.kind === 'confirming' && importState.saving);

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

      {lastUpdated ? <LastUpdated at={lastUpdated} /> : null}

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
    </div>
  );
}

/** The date is in the browser's time zone, after hydration: the server's can put a save on another day. */
function LastUpdated({ at }: { at: string }) {
  const hydrated = useHydrated();
  return <p className="text-muted-foreground text-xs">Last updated {hydrated ? formatDate(at) : '…'}</p>;
}

const NotSet = () => <p className="text-muted-foreground text-sm">Not set</p>;

function SectionView({ sectionKey, resume }: { sectionKey: SectionKey; resume: StructuredResume }) {
  if (sectionKey === 'basics') {
    const { name, label, email, phone, summary } = resume.basics;
    const contact = [email, phone].filter((part) => part?.trim()).join(' · ');
    if (!name.trim() && !label?.trim() && !contact && !summary.trim()) return <NotSet />;
    return (
      <div className="space-y-1 text-sm">
        {name.trim() ? <p className="font-medium">{name}</p> : null}
        {label?.trim() ? <p>{label}</p> : null}
        {contact ? <p className="text-muted-foreground">{contact}</p> : null}
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
              {role.highlights.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-5">
                  {role.highlights.map((line, lineIndex) => (
                    <li key={lineIndex}>{line}</li>
                  ))}
                </ul>
              ) : null}
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
          return (
            <li key={index} className="space-y-0.5 py-3 text-sm first:pt-0 last:pb-0">
              <p className="font-medium">{entry.institution.trim() || 'No school'}</p>
              {degree || dates ? (
                <p className="text-muted-foreground">{[degree, dates].filter(Boolean).join(' · ')}</p>
              ) : null}
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
            {project.url?.trim() ? <p className="text-muted-foreground break-all">{project.url}</p> : null}
            {project.description?.trim() ? <p>{project.description}</p> : null}
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
    return (
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
        <div className="sm:col-span-2">
          <Field id="resume-basics-summary" label="Summary">
            <Textarea id="resume-basics-summary" rows={3} value={basics.summary} onChange={(e) => set('summary', e.target.value)} />
          </Field>
        </div>
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
            <Field id={`resume-work-${index}-highlights`} label="Bullets, one per line">
              <Textarea
                id={`resume-work-${index}-highlights`}
                rows={4}
                value={role.highlights.join('\n')}
                onChange={(e) => set(index, 'highlights', e.target.value.split('\n'))}
              />
            </Field>
          </>
        )}
        itemLabel={(role) => role.company.trim() || role.position.trim() || 'this role'}
        onRemove={onRemove}
      />
    );
  }

  if (sectionKey === 'education') {
    const entries = value as ResumeEducation[];
    const set = (index: number, field: keyof ResumeEducation, text: string) =>
      onChange(entries.map((entry, i) => (i === index ? { ...entry, [field]: text } : entry)));
    return (
      <ItemList
        items={entries}
        addLabel="Add education"
        onAdd={() => onChange([...entries, { institution: '' }])}
        render={(entry, index) => (
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
            <Field id={`resume-education-${index}-end`} label="Finished">
              <Input id={`resume-education-${index}-end`} value={entry.endDate ?? ''} placeholder="e.g. 2024-06" onChange={(e) => set(index, 'endDate', e.target.value)} />
            </Field>
          </div>
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
        render={(group, index) => (
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Field id={`resume-skills-${index}-category`} label="Group">
              <Input id={`resume-skills-${index}-category`} value={group.category} onChange={(e) => set(index, { ...group, category: e.target.value })} />
            </Field>
            <Field id={`resume-skills-${index}-skills`} label="Skills, separated by commas">
              <Input
                id={`resume-skills-${index}-skills`}
                value={group.skills.join(', ')}
                onChange={(e) => set(index, { ...group, skills: e.target.value.split(',').map((skill) => skill.trimStart()) })}
              />
            </Field>
          </div>
        )}
        itemLabel={(group) => group.category.trim() || 'this group'}
        onRemove={onRemove}
      />
    );
  }

  if (sectionKey === 'projects') {
    const projects = value as ResumeProject[];
    const set = (index: number, field: keyof ResumeProject, text: string) =>
      onChange(projects.map((project, i) => (i === index ? { ...project, [field]: text } : project)));
    return (
      <ItemList
        items={projects}
        addLabel="Add a project"
        onAdd={() => onChange([...projects, { name: '' }])}
        render={(project, index) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`resume-projects-${index}-name`} label="Name">
              <Input id={`resume-projects-${index}-name`} value={project.name} onChange={(e) => set(index, 'name', e.target.value)} />
            </Field>
            <Field id={`resume-projects-${index}-url`} label="Link">
              <Input id={`resume-projects-${index}-url`} value={project.url ?? ''} onChange={(e) => set(index, 'url', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field id={`resume-projects-${index}-description`} label="Description">
                <Textarea id={`resume-projects-${index}-description`} rows={2} value={project.description ?? ''} onChange={(e) => set(index, 'description', e.target.value)} />
              </Field>
            </div>
          </div>
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
      render={(certificate, index) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`resume-certificates-${index}-name`} label="Name">
            <Input id={`resume-certificates-${index}-name`} value={certificate.name} onChange={(e) => set(index, 'name', e.target.value)} />
          </Field>
          <Field id={`resume-certificates-${index}-issuer`} label="Issuer">
            <Input id={`resume-certificates-${index}-issuer`} value={certificate.issuer} onChange={(e) => set(index, 'issuer', e.target.value)} />
          </Field>
          <Field id={`resume-certificates-${index}-date`} label="Date">
            <Input id={`resume-certificates-${index}-date`} value={certificate.date ?? ''} placeholder="e.g. 2024-06" onChange={(e) => set(index, 'date', e.target.value)} />
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
  render: (item: T, index: number) => ReactNode;
  itemLabel: (item: T) => string;
  onRemove: (index: number, label: string) => void;
}

/** Items separated by dividers, each with a plain Remove (undoable), and one Add below. */
function ItemList<T>({ items, addLabel, onAdd, render, itemLabel, onRemove }: ItemListProps<T>) {
  return (
    <div className="space-y-3">
      <ol className="divide-y">
        {items.map((item, index) => (
          <li key={index} className="space-y-3 py-3 first:pt-0">
            {render(item, index)}
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                aria-label={`Remove ${itemLabel(item)}`}
                onClick={() => onRemove(index, itemLabel(item))}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button variant="outline" size="sm" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  );
}
