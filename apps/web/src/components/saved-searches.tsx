'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createSavedSearch,
  deleteSavedSearch,
  fetchSavedSearches,
  runDiscovery,
  type SavedSearchItem,
} from '@/lib/api';

export function SavedSearchesManager() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [adding, setAdding] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSavedSearches()
      .then(setSearches)
      .catch(() => toast.error('Could not load saved searches.'))
      .finally(() => setLoading(false));
  }, []);

  async function onAdd(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const created = await createSavedSearch({ query: trimmed, location: location.trim() || undefined });
      setSearches((prev) => [created, ...prev]);
      setQuery('');
      setLocation('');
      toast.success('Saved search added.');
    } catch {
      toast.error('Could not add the saved search.');
    } finally {
      setAdding(false);
    }
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteSavedSearch(id);
      setSearches((prev) => prev.filter((entry) => entry.id !== id));
    } catch {
      toast.error('Could not delete the saved search.');
    } finally {
      setDeletingId(null);
    }
  }

  async function onDiscover() {
    setDiscovering(true);
    try {
      const result = await runDiscovery();
      toast.success(
        result.inserted > 0
          ? `Found ${result.inserted} new job${result.inserted === 1 ? '' : 's'} (${result.skipped} already tracked) via ${result.source}.`
          : `No new jobs found (${result.skipped} already tracked).`,
      );
      router.refresh();
    } catch {
      toast.error('Discovery failed. Add at least one saved search first.');
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Role or keywords, e.g. AI engineer"
          aria-label="Search query"
          className="flex-1"
        />
        <Input
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="Location (optional)"
          aria-label="Location"
          className="sm:w-44"
        />
        <Button type="submit" size="sm" disabled={adding || !query.trim()}>
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </form>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : searches.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No saved searches yet. Add one above, then run discovery to pull real postings into your CRM.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {searches.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-medium">{entry.query}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {entry.location || 'Anywhere'}
                  {entry.remoteOnly ? ' · remote only' : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete saved search"
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

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={discovering || searches.length === 0} onClick={() => void onDiscover()}>
          {discovering ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Discover now
        </Button>
        <p className="text-muted-foreground text-xs">
          Pulls real postings from your sources and adds new ones to your jobs.
        </p>
      </div>
    </div>
  );
}
