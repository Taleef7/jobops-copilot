'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { MoveButtons, MoveMessage, useReorder, type Direction } from '@/components/reorder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage, saveResumeLayout } from '@/lib/api';
import {
  DEFAULT_TITLES,
  SECTION_KEYS,
  SECTION_TITLE_MAX,
  headingOf,
  layoutRows,
  moveItem,
  rowsToSections,
  type LayoutRow,
} from '@/lib/resume-layout';
import type { ResumeLayout, ResumeSectionKey } from '@/types/job';

type PageSize = NonNullable<ResumeLayout['pageSize']>;
type Typing = Partial<Record<ResumeSectionKey, string>>;

/** `typing` without the heading being typed for `key`. */
function done(typing: Typing, key: ResumeSectionKey): Typing {
  const rest = { ...typing };
  delete rest[key];
  return rest;
}

interface ResumeLayoutEditorProps {
  initial: ResumeLayout | undefined;
  /** No résumé yet: there is nothing to lay out (the API answers 404). */
  disabled?: boolean;
  /** The layout as the API saved it. */
  onSaved?: (layout: ResumeLayout) => void;
  /** Settles once every change made so far is saved (or failed): a résumé save waits for it. */
  onPending?: (settled: Promise<void>) => void;
}

/**
 * The PDF's sections (#415): their order, headings and whether each prints, and the page size.
 * Every change saves at once; one that fails is put back, with a toast. Tailored résumés print
 * with this layout until they are downloaded.
 */
export function ResumeLayoutEditor({ initial, disabled = false, onSaved, onPending }: ResumeLayoutEditorProps) {
  const [rows, setRows] = useState(() => layoutRows(initial));
  const [pageSize, setPageSize] = useState<PageSize>(initial?.pageSize ?? 'letter');
  // A heading being typed, saved on Enter or when the field is left; Escape drops it.
  const [typing, setTyping] = useState<Typing>({});
  // What the API last saved: a failed save puts the editor back to it.
  const saved = useRef({ rows: layoutRows(initial), pageSize: initial?.pageSize ?? ('letter' as PageSize) });
  // Saves go one at a time, in order; each sends the whole of what it changes.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  const { container, message, move: moveAndSay, say } = useReorder();

  function save(patch: ResumeLayout) {
    const mine = (latest.current += 1);
    queue.current = queue.current.then(async () => {
      try {
        const layout = await saveResumeLayout(patch);
        saved.current = {
          rows: layout.sections ? layoutRows(layout) : saved.current.rows,
          pageSize: layout.pageSize ?? saved.current.pageSize,
        };
        onSaved?.(layout);
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't save the sections. Try again."));
        // A later change is on its way with the whole list: it puts this one right.
        if (mine === latest.current) {
          setRows(saved.current.rows);
          setPageSize(saved.current.pageSize);
        }
      }
    });
    onPending?.(queue.current);
  }

  function change(next: LayoutRow[]) {
    setRows(next);
    save({ sections: rowsToSections(next) });
  }

  function move(index: number, to: number, direction: Direction) {
    moveAndSay(() => change(moveItem(rows, index, to)), headingOf(rows[index]!), to, rows.length, direction);
  }

  function rename(key: ResumeSectionKey) {
    const row = rows.find((r) => r.key === key)!;
    const text = (typing[key] ?? headingOf(row)).trim();
    setTyping((current) => done(current, key));
    const title = text === DEFAULT_TITLES[key] ? '' : text;
    if (title === row.title) return;
    change(rows.map((r) => (r.key === key ? { ...r, title } : r)));
  }

  function toggle(key: ResumeSectionKey) {
    const row = rows.find((r) => r.key === key)!;
    change(rows.map((r) => (r.key === key ? { ...r, hidden: !r.hidden } : r)));
    say(`${headingOf(row)} ${row.hidden ? 'shown in' : 'hidden from'} the PDF`);
  }

  function reset() {
    change(SECTION_KEYS.map((key) => ({ key, title: '', hidden: false })));
    setTyping({});
    say('Sections reset to the default order and headings');
  }

  return (
    <section aria-labelledby="resume-layout-title" className="space-y-3">
      <div className="space-y-1">
        <h3 id="resume-layout-title" className="text-sm font-semibold">
          Sections
        </h3>
        <p className="text-muted-foreground text-xs">
          {disabled
            ? 'Save your résumé first, then arrange its sections here.'
            : 'The order and headings your PDF uses. Tailored résumés follow them until you download one. Changes save as you make them.'}
        </p>
      </div>
      <div ref={container}>
        <ol aria-label="Sections, in the order they print" className="divide-y rounded-md border">
          {rows.map((row, index) => {
            const heading = headingOf(row);
            const id = `resume-layout-${row.key}`;
            return (
              <li key={row.key} className="flex flex-wrap items-end gap-2 p-2">
                <div className="min-w-40 flex-1 space-y-1">
                  <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
                    {DEFAULT_TITLES[row.key]}
                    <span className="sr-only"> heading</span>
                    {row.hidden ? <span className="ml-2 font-medium">Hidden</span> : null}
                  </Label>
                  <Input
                    id={id}
                    value={typing[row.key] ?? heading}
                    maxLength={SECTION_TITLE_MAX}
                    disabled={disabled}
                    className={row.hidden ? 'text-muted-foreground' : undefined}
                    onChange={(event) => setTyping((current) => ({ ...current, [row.key]: event.target.value }))}
                    onBlur={() => rename(row.key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        rename(row.key);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setTyping((current) => done(current, row.key));
                      }
                    }}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <MoveButtons
                    index={index}
                    count={rows.length}
                    label={heading}
                    disabled={disabled}
                    onMove={(to, direction) => move(index, to, direction)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${row.hidden ? 'Show' : 'Hide'} ${heading}`}
                    disabled={disabled}
                    onClick={() => toggle(row.key)}
                  >
                    {row.hidden ? 'Show' : 'Hide'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        <MoveMessage message={message} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor="resume-layout-page-size">Page size</Label>
          <select
            id="resume-layout-page-size"
            value={pageSize}
            disabled={disabled}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            onChange={(event) => {
              const next = event.target.value as PageSize;
              setPageSize(next);
              save({ pageSize: next });
            }}
          >
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={reset}>
          Reset to default
        </Button>
      </div>
    </section>
  );
}
