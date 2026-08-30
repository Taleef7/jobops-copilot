'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createTargetCompany,
  deleteTargetCompany,
  fetchTargetCompanies,
  setTargetCompanyEnabled,
  type TargetCompanyBoardType,
  type TargetCompanyItem,
} from '@/lib/api';

const BOARD_TYPE_OPTIONS: { value: TargetCompanyBoardType; label: string }[] = [
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'ashby', label: 'Ashby' },
];

export function TargetCompaniesManager() {
  const [companies, setCompanies] = useState<TargetCompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState('');
  const [boardType, setBoardType] = useState<TargetCompanyBoardType>('greenhouse');
  const [boardToken, setBoardToken] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTargetCompanies()
      .then(setCompanies)
      .catch(() => toast.error('Could not load target companies.'))
      .finally(() => setLoading(false));
  }, []);

  async function onAdd(event: React.FormEvent) {
    event.preventDefault();
    const trimmedCompany = company.trim();
    const trimmedToken = boardToken.trim();
    if (!trimmedCompany || !trimmedToken) return;
    setAdding(true);
    try {
      const created = await createTargetCompany({
        company: trimmedCompany,
        boardType,
        boardToken: trimmedToken,
      });
      setCompanies((prev) => [created, ...prev]);
      setCompany('');
      setBoardToken('');
      toast.success('Target company added.');
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 409) {
        toast.error('This board is already tracked.');
      } else {
        toast.error('Could not add the target company.');
      }
    } finally {
      setAdding(false);
    }
  }

  async function onToggle(entry: TargetCompanyItem) {
    setTogglingId(entry.id);
    try {
      const updated = await setTargetCompanyEnabled(entry.id, !entry.enabled);
      setCompanies((prev) => prev.map((c) => (c.id === entry.id ? updated : c)));
    } catch {
      toast.error('Could not update target company.');
    } finally {
      setTogglingId(null);
    }
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteTargetCompany(id);
      setCompanies((prev) => prev.filter((entry) => entry.id !== id));
    } catch {
      toast.error('Could not delete the target company.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Input
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Company name, e.g. Stripe"
            aria-label="Company name"
          />
        </div>
        <select
          value={boardType}
          onChange={(event) => setBoardType(event.target.value as TargetCompanyBoardType)}
          aria-label="Board type"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {BOARD_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex-1 space-y-1">
          <Input
            value={boardToken}
            onChange={(event) => setBoardToken(event.target.value)}
            placeholder="Board slug, e.g. stripe"
            aria-label="Board token"
          />
          <p className="text-muted-foreground text-xs">
            The public board slug — e.g. <code>stripe</code> in boards.greenhouse.io/stripe
          </p>
        </div>
        <Button type="submit" size="sm" disabled={adding || !company.trim() || !boardToken.trim()}>
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </form>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : companies.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No target companies yet. Add one above to start tracking their job boards.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {companies.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-medium">{entry.company}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {entry.boardType} · {entry.boardToken}
                  {!entry.enabled ? ' · paused' : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={entry.enabled ? 'Pause tracking' : 'Resume tracking'}
                disabled={togglingId === entry.id}
                onClick={() => void onToggle(entry)}
              >
                {togglingId === entry.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : entry.enabled ? (
                  'Pause'
                ) : (
                  'Resume'
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete target company"
                disabled={deletingId === entry.id}
                onClick={() => void onDelete(entry.id)}
              >
                {deletingId === entry.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
