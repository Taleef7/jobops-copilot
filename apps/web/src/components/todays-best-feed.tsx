'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FeedCard } from '@/components/feed-card';
import { FeedFilters, type FeedFilterState } from '@/components/feed-filters';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchRankedFeed } from '@/lib/api';
import type { FeedItem, FeedResult, JobSeniority, JobStatus, WorkplaceType } from '@/types/job';

interface TodaysBestFeedProps {
  initialFeed: FeedResult;
  source: 'api' | 'seed';
}

const defaultFilters: FeedFilterState = {
  query: '',
  minScore: 'all',
  seniority: 'all',
  sponsorOnly: 'all',
  workplaceType: 'all',
  status: 'all',
};

export function TodaysBestFeed({ initialFeed, source }: TodaysBestFeedProps) {
  const [filters, setFilters] = useState<FeedFilterState>(defaultFilters);
  const [feed, setFeed] = useState<FeedResult>(initialFeed);
  const [isPending, startTransition] = useTransition();

  async function loadFeedWithFilters(newFilters: FeedFilterState) {
    startTransition(async () => {
      try {
        const minScore = newFilters.minScore !== 'all' ? parseInt(newFilters.minScore, 10) : undefined;
        const seniority = newFilters.seniority !== 'all' ? (newFilters.seniority as JobSeniority) : undefined;
        const sponsorOnly = newFilters.sponsorOnly === 'sponsor_only';
        const workplaceType =
          newFilters.workplaceType !== 'all' ? (newFilters.workplaceType as WorkplaceType) : undefined;
        const status = newFilters.status !== 'all' ? (newFilters.status as JobStatus) : undefined;

        const result = await fetchRankedFeed({
          minScore,
          seniority,
          sponsorOnly,
          workplaceType,
          status,
          limit: 50,
        });
        setFeed(result);
      } catch {
        // Keep current items if network fails
      }
    });
  }

  function handleFilterChange(newFilters: FeedFilterState) {
    setFilters(newFilters);
    // Reload from server when server-filtered fields change
    if (
      newFilters.minScore !== filters.minScore ||
      newFilters.seniority !== filters.seniority ||
      newFilters.sponsorOnly !== filters.sponsorOnly ||
      newFilters.workplaceType !== filters.workplaceType ||
      newFilters.status !== filters.status
    ) {
      loadFeedWithFilters(newFilters);
    }
  }

  function handleResetFilters() {
    setFilters(defaultFilters);
    loadFeedWithFilters(defaultFilters);
  }

  function handleStatusChange(jobId: string, newStatus: JobStatus) {
    setFeed((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.job.id === jobId
          ? {
              ...item,
              job: { ...item.job, status: newStatus },
            }
          : item,
      ),
    }));
  }

  // Client-side text query search across company, title, location, and skills
  const query = filters.query.trim().toLowerCase();
  const visibleItems: FeedItem[] = query
    ? feed.items.filter((item) => {
        const searchable = [
          item.job.title,
          item.job.company,
          item.job.location,
          item.job.notes ?? '',
          ...(item.job.analysis?.matchedSkills ?? []),
          ...(item.rankReasons ?? []),
        ]
          .join(' ')
          .toLowerCase();
        return searchable.includes(query);
      })
    : feed.items;

  return (
    <div className="space-y-5">
      {/* Feed Controls & Toolbar */}
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <FeedFilters
          filters={filters}
          onChange={handleFilterChange}
          onReset={handleResetFilters}
        />
      </div>

      {/* Feed Status Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium">
          <Sparkles className="size-3.5 text-primary" />
          <span>
            {visibleItems.length === 1
              ? '1 curated opportunity'
              : `${visibleItems.length} curated opportunities`}
            {feed.total > visibleItems.length && !query && ` of ${feed.total} total`}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>Ranked by interview conversion feedback & fit</span>
          {source === 'seed' && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">· Demo mode</span>
          )}
        </div>

        {isPending && (
          <div className="flex items-center gap-1 text-primary text-xs font-medium animate-pulse">
            <Loader2 className="size-3.5 animate-spin" />
            Updating recommendations...
          </div>
        )}
      </div>

      {/* Loading Skeletons */}
      {isPending && visibleItems.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border p-5 space-y-4 bg-card/50">
              <div className="flex justify-between items-start gap-4">
                <div className="flex gap-3">
                  <Skeleton className="size-11 rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
                <Skeleton className="size-12 rounded-full" />
              </div>
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title="No curated jobs match these filters"
          description="Try broadening your criteria or reset your filters to see Today's Best opportunities."
          actionLabel="Reset filters"
          onAction={handleResetFilters}
        />
      ) : (
        /* Ranked Feed Cards */
        <div className="space-y-4">
          {visibleItems.map((item) => (
            <FeedCard
              key={item.job.id}
              item={item}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
