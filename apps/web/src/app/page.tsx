import Link from 'next/link';
import { loadJobs } from '@/lib/job-data';
import { getDashboardSummary } from '@/lib/dashboard';
import { formatPercent } from '@/lib/format';
import { StatCard } from '@/components/stat-card';
import { SectionCard } from '@/components/section-card';
import { StatusPill } from '@/components/status-pill';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const { jobs, source } = await loadJobs();
  const summary = getDashboardSummary(jobs);
  const recentJobs = [...jobs]
    .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
    .slice(0, 3);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Foundation preview</p>
        <h2 className="hero__title">A CRM-style control center for the job search pipeline.</h2>
        <p className="hero__lead">
          This first phase gives us a polished dashboard, mock data, and the project scaffolding
          needed for job intake, AI analysis, outreach drafting, and weekly reporting in later
          phases.
        </p>
        <div className="hero__actions">
          <Link className="button button--primary" href="/jobs/new">
            Add a job
          </Link>
          <Link className="button button--ghost" href="/reports">
            View reports
          </Link>
        </div>
      </section>

      {source === 'seed' ? (
        <div className="callout callout--accent">
          <p className="callout__title">Seed data shown</p>
          <p className="callout__text">
            The API is not reachable right now, so the dashboard is rendering the local seed data.
            Once the backend is running, this screen will switch to live CRM data automatically.
          </p>
        </div>
      ) : null}

      <section className="grid grid--metrics">
        <StatCard
          label="Jobs tracked"
          value={String(summary.totalJobs)}
          detail="All opportunities stored in a CRM-style workflow."
        />
        <StatCard
          label="Average fit score"
          value={formatPercent(summary.averageFitScore)}
          detail="Derived from the current mock job set."
        />
        <StatCard
          label="Outreach drafts"
          value={String(summary.outreachDrafts)}
          detail="Human-reviewed message drafts waiting for approval."
        />
        <StatCard
          label="Follow-ups due"
          value={String(summary.followUpsDue)}
          detail="Jobs that should be revisited soon."
        />
      </section>

      <section className="grid grid--two">
        <SectionCard
          title="Pipeline snapshot"
          description="A quick look at the current state of the search funnel."
        >
          <div className="inline-metrics">
            <div className="inline-metric">
              <strong>{summary.statusCounts.shortlisted}</strong>
              <span>Shortlisted</span>
            </div>
            <div className="inline-metric">
              <strong>{summary.statusCounts.applied}</strong>
              <span>Applied</span>
            </div>
            <div className="inline-metric">
              <strong>{summary.statusCounts.outreach_drafted + summary.statusCounts.outreach_sent}</strong>
              <span>Outreach active</span>
            </div>
            <div className="inline-metric">
              <strong>{summary.statusCounts.interview}</strong>
              <span>Interviews</span>
            </div>
          </div>

          <div className="stack" style={{ marginTop: '1rem' }}>
            {recentJobs.map((job) => (
              <div key={job.id} className="callout">
                <div className="split" style={{ alignItems: 'center' }}>
                  <div>
                    <strong>{job.title}</strong>
                    <div className="table-copy">
                      {job.company} · {job.location}
                    </div>
                  </div>
                  <div style={{ justifySelf: 'end' }}>
                    <StatusPill status={job.status} />
                  </div>
                </div>
                <p className="callout__text">{job.nextAction}</p>
                <Link className="button button--ghost" href={`/jobs/${job.id}`}>
                  Open job detail
                </Link>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Top missing skills"
          description="The most common gaps across the current target set."
        >
          <div className="report-bars">
            {summary.topMissingSkills.map((skill) => (
              <div className="report-bar" key={skill.skill}>
                <div className="report-bar__label">
                  <span>{skill.skill}</span>
                  <strong>{skill.count}</strong>
                </div>
                <div className="report-bar__track">
                  <div
                    className="report-bar__fill"
                    style={{ width: `${Math.max(18, skill.count * 20)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <SectionCard
        title="What this phase already proves"
        description="The foundation is intentionally mock-backed, but the product shape is already real."
      >
        <div className="grid grid--three">
          <div className="detail-card">
            <h3 className="detail-card__title">Frontend shell</h3>
            <p className="detail-card__value">
              A dashboard-first Next.js app with pages for jobs, outreach, reports, and settings.
            </p>
          </div>
          <div className="detail-card">
            <h3 className="detail-card__title">Backend scaffold</h3>
            <p className="detail-card__value">
              An Express API with health, jobs, and AI placeholder endpoints ready for real logic.
            </p>
          </div>
          <div className="detail-card">
            <h3 className="detail-card__title">Ops discipline</h3>
            <p className="detail-card__value">
              The docs, schema drafts, prompt templates, and workflow notes are already in place.
            </p>
          </div>
        </div>
      </SectionCard>
    </>
  );
}
