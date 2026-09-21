import type { Metadata } from 'next';
import { Briefcase, Compass, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { JobsTable } from '@/components/jobs-table';
import { SavedSearchesManager } from '@/components/saved-searches';
import { SectionCard } from '@/components/section-card';
import { TodaysBestFeed } from '@/components/todays-best-feed';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loadJobs, loadRankedFeed } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Jobs' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; tab?: string | string[] }>;
}) {
  const [{ jobs, source: jobsSource }, { feed, source: feedSource }, { q, tab }] = await Promise.all([
    loadJobs(),
    loadRankedFeed({ limit: 50 }),
    searchParams,
  ]);

  const initialQuery = Array.isArray(q) ? (q[0] ?? '') : (q ?? '');
  const activeTab = (Array.isArray(tab) ? tab[0] : tab) || 'feed';
  const source = feedSource === 'seed' || jobsSource === 'seed' ? 'seed' : 'api';

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

      {source === 'seed' ? (
        <Card className="border-amber-500/30 bg-amber-500/5 gap-1 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Seed data shown</p>
          <p className="text-muted-foreground text-sm">
            The API is not reachable, so this page is rendering the local seed dataset.
          </p>
        </Card>
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
          <TodaysBestFeed initialFeed={feed} source={feedSource} />
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

