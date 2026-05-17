import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { SectionCard } from '@/components/section-card';
import { StatusPill } from '@/components/status-pill';
import { mockOutreachDrafts } from '@/lib/mock-data';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Outreach',
};

export default function OutreachPage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Human review</p>
        <h2 className="hero__title">Draft outreach is always reviewed before anything is sent.</h2>
        <p className="hero__lead">
          This page previews the recruiter, referral, and follow-up messages that will be stored in
          the outreach table and kept in draft mode until the user approves them.
        </p>
        <div className="hero__actions">
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </section>

      <SectionCard
        title="Draft inbox"
        description="The mock data shows the exact state the future outreach table will surface."
      >
        {mockOutreachDrafts.length === 0 ? (
          <EmptyState
            title="No outreach drafts yet"
            description="Drafts will appear here after the AI outreach endpoint is connected."
            actionLabel="Open jobs"
            actionHref="/jobs"
          />
        ) : (
          <div className="stack">
            {mockOutreachDrafts.map((draft) => (
              <div key={draft.id} className="detail-card">
                <div className="split">
                  <div>
                    <p className="detail-card__title">
                      {draft.contactName} · {draft.contactRole}
                    </p>
                    <p className="detail-card__value">{draft.draftText}</p>
                    <div className="chip-row" style={{ marginTop: '0.75rem' }}>
                      <span className="chip">{draft.messageType.replaceAll('_', ' ')}</span>
                      {draft.followUpDue ? <span className="chip">Follow-up {formatDate(draft.followUpDue)}</span> : null}
                    </div>
                  </div>
                  <div style={{ justifySelf: 'end' }}>
                    <StatusPill status={draft.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Approval policy"
        description="The product always drafts first and sends only when a human confirms the action."
      >
        <ul className="list">
          <li>No automatic emails or LinkedIn messages.</li>
          <li>All outreach carries a draft, approved, sent, or skipped status.</li>
          <li>Follow-up reminders are generated only after the user reviews the draft.</li>
          <li>The wording stays truthful and never invents experience.</li>
        </ul>
      </SectionCard>
    </div>
  );
}
