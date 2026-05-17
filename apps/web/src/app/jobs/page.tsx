import type { Metadata } from 'next';
import Link from 'next/link';
import { JobsTable } from '@/components/jobs-table';
import { SectionCard } from '@/components/section-card';
import { loadJobs } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Jobs',
};

export default async function JobsPage() {
  const { jobs, source } = await loadJobs();

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">CRM view</p>
        <h2 className="hero__title">All tracked opportunities in one place.</h2>
        <p className="hero__lead">
          Search, triage, and update jobs from a single dashboard. Phase 0 is mock-backed, but the
          layout and workflow are already designed for a real database in Phase 1.
        </p>
        <div className="hero__actions">
          <Link className="button button--primary" href="/jobs/new">
            Add job
          </Link>
          <Link className="button button--ghost" href="/outreach">
            Review outreach
          </Link>
        </div>
      </section>

      {source === 'seed' ? (
        <div className="callout callout--accent">
          <p className="callout__title">Seed data shown</p>
          <p className="callout__text">
            The API is not reachable right now, so the app is rendering the local seed dataset.
            Once the backend is running, this page will use live CRM data automatically.
          </p>
        </div>
      ) : null}

      <SectionCard
        title="Job pipeline"
        description="Quick filters help you find the right follow-up or outreach action fast."
      >
        <JobsTable jobs={jobs} />
      </SectionCard>
    </div>
  );
}
