import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { SectionCard } from '@/components/section-card';
import { mockWeeklyReports } from '@/lib/mock-data';

export const metadata: Metadata = {
  title: 'Reports',
};

export default function ReportsPage() {
  const report = mockWeeklyReports[0];

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
          The eventual weekly report will summarize pipeline health, missing skills, outreach
          responses, interviews, and the next priorities. This scaffold already shows the expected
          structure.
        </p>
        <div className="hero__actions">
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </section>

      <div className="grid grid--two">
        <SectionCard
          title="Latest weekly report"
          description={`${report.weekStart} to ${report.weekEnd}`}
        >
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
            <p className="detail-card__value">{report.reportMarkdown}</p>
          </div>
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
    </div>
  );
}
