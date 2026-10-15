import type { Metadata } from 'next';
import { Briefcase, Compass, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ErrorState } from '@/components/error-state';
import { JobsTable } from '@/components/jobs-table';
import { LoadFailure } from '@/components/load-failure';
import { SavedSearchesManager } from '@/components/saved-searches';
import { SectionCard } from '@/components/section-card';
import { TodaysBestFeed } from '@/components/todays-best-feed';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loadJobs, loadRankedFeed } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Jobs' };

type Param = string | string[] | undefined;

function count(value: Param): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^\d+$/.test(text) ? Number(text) : null;
}

/** What onboarding's discovery added, from ?added=&skipped= (#353); null without a count. */
function discoveryNote(added: Param, skipped: Param): string | null {
  const addedCount = count(added);
  if (addedCount === null) return null;
  const skippedCount = count(skipped) ?? 0;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `Added ${plural(addedCount, 'job')}${skippedCount > 0 ? `, skipped ${plural(skippedCount, 'duplicate')}` : ''}.`;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: Param; tab?: Param; added?: Param; skipped?: Param }>;
}) {
  const [{ jobs, error }, { feed, error: feedError }, { q, tab, added, skipped }] = await Promise.all([
    loadJobs(),
    loadRankedFeed({ limit: 50 }),
    searchParams,
  ]);

  const initialQuery = Array.isArray(q) ? (q[0] ?? '') : (q ?? '');
  // A search (the header box lands here with ?q=) opens the pipeline, the tab it filters (#353).
  const activeTab = (Array.isArray(tab) ? tab[0] : tab) || (initialQuery.trim() ? 'pipeline' : 'feed');
  const note = discoveryNote(added, skipped);
  if (error) return <LoadFailure heading="Jobs" title="Couldn't load your jobs" message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground text-sm">
            Curated daily recommendations, pipeline tracking, and multi-source discovery.
          </p>
        </div>
        <Button render={<Link href="/jobs/new" />} className="gap-1.5">
          <Plus className="size-4" /> Add job
        </Button>
      </div>

      {note ? (
        <p role="status" className="bg-muted rounded-lg px-4 py-3 text-sm">
          {note}
        </p>
      ) : null}

      <Tabs defaultValue={activeTab} className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="feed" className="gap-1.5">
            <Sparkles className="size-4 text-primary" />
            <span>Today&apos;s Best</span>
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1.5">
            <Briefcase className="size-4" />
            <span>Pipeline ({jobs.length})</span>
          </TabsTrigger>
          <TabsTrigger value="searches" className="gap-1.5">
            <Compass className="size-4" />
            <span>Searches</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feed" className="space-y-4">
          {feed ? (
            <TodaysBestFeed initialFeed={feed} />
          ) : (
            <ErrorState title="Couldn't load today's best" message={feedError} />
          )}
        </TabsContent>

        <TabsContent value="pipeline" keepMounted className="space-y-4">
          <SectionCard
            title="Job pipeline"
            description="Filter by status or priority to find your next action fast."
          >
            <JobsTable jobs={jobs} initialQuery={initialQuery} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="searches" className="space-y-4">
          <SectionCard
            title="Find new jobs"
            description="Save target searches, then pull real postings into your pipeline — already scored against your resume."
          >
            <SavedSearchesManager />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

