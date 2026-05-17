import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { OutreachReviewActions } from '@/components/outreach-review-actions';
import { SectionCard } from '@/components/section-card';
import { StatusPill } from '@/components/status-pill';
import { loadOutreach } from '@/lib/outreach-data';
import { formatCompactDateTime, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Outreach',
};

export default async function OutreachPage() {
  const { items, source } = await loadOutreach();

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Human review</p>
        <h2 className="hero__title">Review every outreach draft before it leaves the CRM.</h2>
        <p className="hero__lead">
          The inbox below is live, sorted by newest draft first, and shows the job context alongside
          each message so approval stays intentional.
        </p>
        <div className="hero__actions">
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </section>

      {source === 'seed' ? (
        <div className="callout callout--accent">
          <p className="callout__title">Seed data shown</p>
          <p className="callout__text">
            The API is not reachable right now, so the outreach inbox is rendering the local seed
            dataset and review actions are disabled until the live backend is available.
          </p>
        </div>
      ) : null}

      <SectionCard
        title="Draft inbox"
        description="Drafted, approved, sent, and skipped states stay visible for auditability."
      >
        {items.length === 0 ? (
          <EmptyState
            title="No outreach drafts yet"
            description="Generate a draft from a job detail page and it will appear here for review."
            actionLabel="Open jobs"
            actionHref="/jobs"
          />
        ) : (
          <div className="stack">
            {items.map((item) => (
              <div key={item.draft.id} className="detail-card">
                <div className="split">
                  <div className="stack">
                    <div>
                      <p className="detail-card__title">
                        {item.company} · {item.title}
                      </p>
                      <p className="table-copy">
                        Drafted {formatCompactDateTime(item.draft.createdAt)} · Job status{' '}
                        {item.jobStatus.replaceAll('_', ' ')}
                      </p>
                    </div>
                    <p className="detail-card__value" style={{ whiteSpace: 'pre-wrap' }}>
                      {item.draft.draftText}
                    </p>
                    <div className="chip-row">
                      <span className="chip">{item.draft.messageType.replaceAll('_', ' ')}</span>
                      <span className="chip">{item.priority} priority</span>
                      {item.draft.contactName ? <span className="chip">{item.draft.contactName}</span> : null}
                      {item.draft.contactRole ? <span className="chip">{item.draft.contactRole}</span> : null}
                      {item.draft.email ? <span className="chip">{item.draft.email}</span> : null}
                      {item.draft.contactSource ? <span className="chip">{item.draft.contactSource}</span> : null}
                      {item.draft.followUpDue ? <span className="chip">Follow-up {formatDate(item.draft.followUpDue)}</span> : null}
                    </div>
                  </div>
                  <div className="stack" style={{ justifySelf: 'end' }}>
                    <StatusPill status={item.draft.status} />
                    <StatusPill status={item.jobStatus} />
                    <Link className="button button--ghost" href={`/jobs/${item.jobId}`}>
                      Open job
                    </Link>
                  </div>
                </div>

                <div className="stack" style={{ marginTop: '1rem' }}>
                  <OutreachReviewActions
                    outreachId={item.draft.id}
                    currentStatus={item.draft.status}
                    disabled={source === 'seed'}
                  />
                  {item.draft.gmailDraftId ? (
                    <p className="table-copy">Gmail draft id: {item.draft.gmailDraftId}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Approval policy"
        description="The workflow remains human-first and never auto-sends messages."
      >
        <ul className="list">
          <li>Drafts can be approved, skipped, or marked sent only after a manual send.</li>
          <li>Job detail pages can create new outreach drafts, but the inbox is where review happens.</li>
          <li>Gmail draft support is optional and only runs when the feature flag and credentials are set.</li>
          <li>All outreach remains auditable in the CRM.</li>
        </ul>
      </SectionCard>
    </div>
  );
}
