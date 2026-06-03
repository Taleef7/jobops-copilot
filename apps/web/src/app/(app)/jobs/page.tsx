import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { JobsTable } from '@/components/jobs-table';
import { SectionCard } from '@/components/section-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { loadJobs } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Jobs' };

export default async function JobsPage() {
  const { jobs, source } = await loadJobs();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">Jobs</h2>
          <p className="text-muted-foreground text-sm">
            Search, triage, and update every opportunity in one place.
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

      <SectionCard
        title="Job pipeline"
        description="Filter by status or priority to find your next action fast."
      >
        <JobsTable jobs={jobs} />
      </SectionCard>
    </div>
  );
}
