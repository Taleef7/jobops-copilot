import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { SectionCard } from '@/components/section-card';
import { loadWeeklyReports } from '@/lib/report-data';
import type { WeeklyReport } from '@/types/job';

export const metadata: Metadata = {
  title: 'Reports',
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatWeekRange(report: WeeklyReport) {
  return `${formatDate(report.weekStart)} to ${formatDate(report.weekEnd)}`;
}

function formatSummary(report: WeeklyReport) {
  const highlight = report.recommendations[0] ?? 'keep the pipeline moving';

  return `This snapshot covers ${formatWeekRange(report)}. ${report.jobsDiscovered} jobs were discovered, ${report.jobsApplied} were applied, and the leading recommendation is to ${highlight.toLowerCase()}`;
}

export default async function ReportsPage() {
  const { reports, source } = await loadWeeklyReports();
  const report = reports[0];

  if (!report) {
    return (
      <EmptyState
        title="No weekly report yet"
        description="Once the reporting workflow is wired up, the latest weekly summary will appear here."
        actionLabel="Back to dashboard"
        actionHref="/"
      />
    );
  }

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Weekly analytics</p>
        <h2 className="hero__title">Strategy reporting built for a real job-search operating rhythm.</h2>
        <p className="hero__lead">
          The latest report is saved, exportable, and visible in a running history so you can track
          weekly momentum without digging through manual notes.
        </p>
        <div className="hero__actions">
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
          {report.reportUrl ? (
            <a className="button button--ghost" href={report.reportUrl} target="_blank" rel="noreferrer">
              Open latest export
            </a>
          ) : null}
        </div>
        <p className="eyebrow" style={{ marginTop: '0.5rem' }}>
          Loaded from {source === 'api' ? 'the live API' : 'seed data fallback'}
        </p>
      </section>

      <div className="grid grid--two">
        <SectionCard title="Latest weekly report" description={formatWeekRange(report)}>
          <div className="inline-metrics">
            <div className="inline-metric">
              <strong>{report.jobsDiscovered}</strong>
              <span>Discovered</span>
            </div>
            <div className="inline-metric">
              <strong>{report.jobsShortlisted}</strong>
              <span>Shortlisted</span>
            </div>
            <div className="inline-metric">
              <strong>{report.jobsApplied}</strong>
              <span>Applied</span>
            </div>
            <div className="inline-metric">
              <strong>{report.interviews}</strong>
              <span>Interviews</span>
            </div>
          </div>

          <div className="detail-card">
            <p className="detail-card__title">Summary</p>
            <p className="detail-card__value">{formatSummary(report)}</p>
          </div>

          <p className="eyebrow" style={{ marginTop: '0.75rem' }}>
            Generated {formatDate(report.createdAt)}
          </p>
        </SectionCard>

        <SectionCard title="Recommendations" description="Actionable guidance from the weekly report.">
          <ul className="list">
            {report.recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="Recurring missing skills" description="The report highlights repeated gaps across the funnel.">
        <div className="grid grid--three">
          {report.commonMissingSkills.map((skill, index) => (
            <div className="detail-card" key={skill}>
              <p className="detail-card__title">Gap {index + 1}</p>
              <p className="detail-card__value">{skill}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Report history" description="Saved reports are kept in week order for easy review.">
        <div className="stack">
          {reports.map((item) => (
            <div className="detail-card" key={item.id}>
              <p className="detail-card__title">{formatWeekRange(item)}</p>
              <p className="detail-card__value">{formatSummary(item)}</p>
              <p className="eyebrow" style={{ marginTop: '0.5rem' }}>
                Generated {formatDate(item.createdAt)}
              </p>
              <div className="hero__actions" style={{ marginTop: '0.75rem' }}>
                {item.reportUrl ? (
                  <a className="button button--ghost" href={item.reportUrl} target="_blank" rel="noreferrer">
                    Open export
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
