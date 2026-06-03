import type { Metadata } from 'next';
import Link from 'next/link';
import { JobCreateForm } from '@/components/job-create-form';
import { SectionCard } from '@/components/section-card';

export const metadata: Metadata = {
  title: 'Add Job',
};

export default function AddJobPage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Manual intake</p>
        <h2 className="hero__title">Capture a new opportunity, then run AI analysis from the detail page.</h2>
        <p className="hero__lead">
          This form now posts directly to the API, creates a persistent CRM record, and sends you
          to the new job detail page after save.
        </p>
        <div className="hero__actions">
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </section>

      <div className="detail-grid">
        <SectionCard title="Intake form" description="Create a persistent job record in the CRM.">
          <JobCreateForm />
        </SectionCard>

        <SectionCard
          title="Workflow notes"
          description="Structured CRM intake comes first, then analysis and fit scoring on the detail page."
        >
          <div className="stack">
            <div className="callout callout--accent">
              <p className="callout__title">Save first, then analyze</p>
              <p className="callout__text">
                The job record is saved before AI parsing or fit scoring happens. That keeps the
                workflow auditable and makes the CRM the source of truth.
              </p>
            </div>
            <ul className="list">
              <li>Company, title, description, and priority are validated before save.</li>
              <li>Status defaults to discovered and can be updated from the detail page.</li>
              <li>AI analysis runs on the detail page using the parsed job and demo resume profile.</li>
              <li>Notes are optional but useful for tracking follow-up context.</li>
            </ul>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
