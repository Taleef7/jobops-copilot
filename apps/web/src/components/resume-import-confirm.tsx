'use client';

import { useState } from 'react';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ResumeFlag } from '@/lib/api';
import { formatResumeRange, withEndDate } from '@/lib/resume-display';
import { cn } from '@/lib/utils';
import type { ResumeWorkExperience, StructuredResume } from '@/types/job';

type RoleField = 'company' | 'position' | 'startDate' | 'endDate';

interface ResumeImportConfirmProps {
  parsed: StructuredResume;
  flags: ResumeFlag[];
  onConfirm: (resume: StructuredResume) => void;
  onCancel: () => void;
  saving?: boolean;
  /** Why the last save failed, shown with a retry. */
  error?: string | null;
}

const FIELDS: Array<{ key: RoleField; label: string; hint?: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'position', label: 'Title' },
  { key: 'startDate', label: 'Start', hint: 'e.g. 2024-06' },
  { key: 'endDate', label: 'End', hint: 'Leave empty if current' },
];

const roleLine = (role: ResumeWorkExperience) => {
  const dates = formatResumeRange(role.startDate, role.endDate, role.current);
  const title = `${role.position.trim() || 'No title'} at ${role.company.trim() || 'No company'}`;
  return dates ? `${title} · ${dates}` : title;
};

/**
 * "Check what we read" (#350): the roles an import found, before anything is saved. Each
 * role reads "Position at Company · dates" and can be corrected in place. A flagged field
 * (a bullet's first word taken for the employer, a number stuck to a word) holds "Looks
 * right" until it's changed or explicitly kept.
 */
export function ResumeImportConfirm({ parsed, flags, onConfirm, onCancel, saving = false, error }: ResumeImportConfirmProps) {
  const [work, setWork] = useState<ResumeWorkExperience[]>(parsed.work);
  // A résumé is saved with a name; when none was read, it's asked for here.
  const [name, setName] = useState(parsed.basics.name);
  const nameWasRead = parsed.basics.name.trim() !== '';
  const result = (): StructuredResume => ({ ...parsed, basics: { ...parsed.basics, name: name.trim() }, work });
  const [kept, setKept] = useState<Set<string>>(new Set());
  // Flagged roles start open; any other can be opened to correct.
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(flags.map((flag) => Number(/^work\[(\d+)\]/.exec(flag.path)?.[1])).filter((index) => !Number.isNaN(index))),
  );

  const valueAt = (path: string) => {
    const match = /^work\[(\d+)\]\.(\w+)$/.exec(path);
    if (!match) return undefined;
    return String(work[Number(match[1])]?.[match[2] as RoleField] ?? '');
  };
  // A flag is settled when its field was changed, or the user chose to keep it.
  const unsettled = flags.filter((flag) => !kept.has(flag.path) && valueAt(flag.path) === flag.value);

  const update = (index: number, field: RoleField, value: string) =>
    setWork((roles) =>
      roles.map((role, i) => {
        if (i !== index) return role;
        return field === 'endDate' ? withEndDate(role, value) : { ...role, [field]: value };
      }),
    );

  const others = [
    [parsed.education.length, 'education entry', 'education entries'],
    [parsed.skills.length, 'skill group', 'skill groups'],
    [(parsed.projects ?? []).length, 'project', 'projects'],
    [(parsed.certificates ?? []).length, 'certificate', 'certificates'],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

  return (
    <section aria-labelledby="import-confirm-title" className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 id="import-confirm-title" className="text-sm font-semibold">
          Check what we read
        </h3>
        <p className="text-muted-foreground text-sm">
          Nothing is saved until you choose Looks right. Correct any role that&apos;s wrong.
        </p>
      </div>

      {nameWasRead ? (
        <p className="text-sm">
          {parsed.basics.name}
          {parsed.basics.email ? <span className="text-muted-foreground"> · {parsed.basics.email}</span> : null}
        </p>
      ) : (
        <div className="max-w-sm space-y-1">
          <Label htmlFor="import-basics-name">Name</Label>
          <Input
            id="import-basics-name"
            value={name}
            aria-describedby="import-basics-name-note"
            className={cn(!name.trim() && 'border-amber-500 focus-visible:ring-amber-500/40')}
            onChange={(event) => setName(event.target.value)}
          />
          <p id="import-basics-name-note" className="text-xs text-amber-700 dark:text-amber-400">
            No name was found. Add it to save the résumé.
          </p>
        </div>
      )}

      <ol className="divide-y">
        {work.map((role, index) => {
          const roleFlags = flags.filter((flag) => flag.path.startsWith(`work[${index}].`));
          return (
            <li key={index} className="space-y-3 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{roleLine(role)}</p>
                {!open.has(index) ? (
                  <Button variant="ghost" size="sm" onClick={() => setOpen((current) => new Set(current).add(index))}>
                    Edit
                  </Button>
                ) : null}
              </div>
              {open.has(index) ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.map(({ key, label, hint }) => {
                    const path = `work[${index}].${key}`;
                    const flag = roleFlags.find((candidate) => candidate.path === path);
                    const needsLook = flag !== undefined && unsettled.includes(flag);
                    const id = `import-work-${index}-${key}`;
                    return (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={id}>{label}</Label>
                        <Input
                          id={id}
                          value={String(role[key] ?? '')}
                          placeholder={hint}
                          aria-invalid={needsLook || undefined}
                          aria-describedby={flag ? `${id}-flag` : undefined}
                          className={cn(needsLook && 'border-amber-500 focus-visible:ring-amber-500/40')}
                          onChange={(event) => update(index, key, event.target.value)}
                        />
                        {flag ? (
                          <div id={`${id}-flag`} className="flex flex-wrap items-center gap-2">
                            <p className={cn('text-xs', needsLook ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                              {flag.reason}
                            </p>
                            {needsLook ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => setKept((current) => new Set(current).add(flag.path))}
                              >
                                Keep as is
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {work.length === 0 ? <p className="text-muted-foreground text-sm">No roles were found.</p> : null}

      {others.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Also read: {others.join(', ')}. You can edit these after saving.
        </p>
      ) : null}

      {error ? (
        <ErrorState title="Couldn't save your résumé" message={error} onRetry={() => onConfirm(result())} />
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {unsettled.length > 0 ? (
          <p className="text-muted-foreground mr-auto text-xs">
            {unsettled.length === 1 ? '1 field needs a look.' : `${unsettled.length} fields need a look.`}
          </p>
        ) : null}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => onConfirm(result())} disabled={saving || unsettled.length > 0 || !name.trim()}>
          {saving ? 'Saving…' : 'Looks right'}
        </Button>
      </div>
    </section>
  );
}
