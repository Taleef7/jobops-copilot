import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JobAnalysisActions } from '@/components/job-analysis-actions';
import { JobEditPanel } from '@/components/job-edit-panel';
import { SectionCard } from '@/components/section-card';
import { StatusPill } from '@/components/status-pill';
import { demoProfileText, demoResumeText } from '@/lib/demo-analysis';
import { loadJob, loadJobs } from '@/lib/job-data';
import { formatCompactDateTime, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

type JobDetailParams = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function generateMetadata({ params }: JobDetailParams): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = await loadJob(jobId);

  if (!job) {
    return { title: 'Job detail' };
  }

  return { title: `${job.company} · ${job.title}` };
}

export default async function JobDetailPage({ params }: JobDetailParams) {
  const { jobId } = await params;
  const jobPromise = loadJob(jobId);
  const jobsPromise = loadJobs();
  const { job, source } = await jobPromise;

  if (!job) {
    notFound();
  }

  const { jobs: allJobs } = await jobsPromise;
  const relatedJobs = allJobs.filter((candidate) => candidate.id !== job.id).slice(0, 3);

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Job detail</p>
        <h2 className="hero__title">
          {job.company} · {job.title}
        </h2>
        <p className="hero__lead">{job.descriptionText}</p>
        <div className="chip-row">
          <StatusPill status={job.status} />
          <span className="chip">{job.priority} priority</span>
          <span className="chip">{job.workplaceType}</span>
          <span className="chip">{job.employmentType}</span>
        </div>
        <div className="hero__actions">
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
          <a className="button button--primary" href="#analysis">
            Run AI analysis
          </a>
        </div>
      </section>

      {source === 'seed' ? (
        <div className="callout callout--accent">
          <p className="callout__title">Seed data shown</p>
          <p className="callout__text">
            The backend is not reachable right now, so this detail page is rendering the local seed
            record. Once the API is available, it will read and update live CRM data.
          </p>
        </div>
      ) : null}

      <div className="detail-grid">
        <div className="stack">
          <SectionCard title="Job snapshot" description="Core CRM metadata for this opportunity.">
            <div className="stack">
              <div className="detail-card">
                <p className="detail-card__title">Company / role</p>
                <p className="detail-card__value">
                  {job.company} · {job.title}
                </p>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">Dates</p>
                <p className="detail-card__value">
                  Posted {formatDate(job.datePosted)} · Discovered {formatCompactDateTime(job.discoveredAt)}
                </p>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">Notes</p>
                <p className="detail-card__value">{job.notes ?? 'No notes yet.'}</p>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">Next action</p>
                <p className="detail-card__value">
                  {job.nextAction}
                  {job.nextActionDue ? ` Due ${formatDate(job.nextActionDue)}` : ''}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="analysis"
            title="AI analysis"
            description="Parse the job, score the fit, and keep the output auditable."
          >
            <div className="stack">
              <JobAnalysisActions
                jobId={job.id}
                descriptionText={job.descriptionText}
                resumeText={demoResumeText}
                profileText={demoProfileText}
              />
              <div className="inline-metrics">
                <div className="inline-metric">
                  <strong>{job.fitScore ?? '—'}</strong>
                  <span>Fit score</span>
                </div>
                <div className="inline-metric">
                  <strong>{job.analysis.confidenceScore}</strong>
                  <span>Confidence</span>
                </div>
                <div className="inline-metric">
                  <strong>{job.analysis.modelUsed}</strong>
                  <span>Model</span>
                </div>
              </div>
              <div className="callout">
                <h3 className="callout__title">Fit summary</h3>
                <p className="callout__text">{job.analysis.fitSummary}</p>
              </div>
              <div className="callout">
                <h3 className="callout__title">Recommended resume angle</h3>
                <p className="callout__text">{job.analysis.recommendedResumeAngle}</p>
              </div>
              <div className="split">
                <div className="detail-card">
                  <p className="detail-card__title">Required skills</p>
                  <p className="detail-card__value">{job.analysis.requiredSkills.join(', ') || 'Not parsed yet.'}</p>
                </div>
                <div className="detail-card">
                  <p className="detail-card__title">Preferred skills</p>
                  <p className="detail-card__value">{job.analysis.preferredSkills.join(', ') || 'Not parsed yet.'}</p>
                </div>
              </div>
              <div className="split">
                <div className="detail-card">
                  <p className="detail-card__title">Matched skills</p>
                  <p className="detail-card__value">{job.analysis.matchedSkills.join(', ') || 'None yet.'}</p>
                </div>
                <div className="detail-card">
                  <p className="detail-card__title">Missing skills</p>
                  <p className="detail-card__value">{job.analysis.missingSkills.join(', ') || 'None yet.'}</p>
                </div>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">ATS keywords</p>
                <p className="detail-card__value">{job.analysis.atsKeywords.join(', ') || 'No keywords captured yet.'}</p>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">Apply recommendation</p>
                <p className="detail-card__value">{job.analysis.applyRecommendation}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Outreach drafts" description="Messages stay draft-only until approved.">
            {job.outreach.length === 0 ? (
              <div className="empty-state">
                <h3>No outreach drafted yet</h3>
                <p>Generate a recruiter, referral, or follow-up draft in the next phase.</p>
              </div>
            ) : (
              <div className="stack">
                {job.outreach.map((draft) => (
                  <div key={draft.id} className="detail-card">
                    <div className="split">
                      <div>
                        <p className="detail-card__title">
                          {draft.contactName} · {draft.contactRole}
                        </p>
                        <p className="detail-card__value">{draft.draftText}</p>
                      </div>
                      <div style={{ justifySelf: 'end' }}>
                        <StatusPill status={draft.status} />
                      </div>
                    </div>
                    <div className="chip-row">
                      <span className="chip">{draft.messageType.replaceAll('_', ' ')}</span>
                      {draft.followUpDue ? <span className="chip">Follow-up {formatDate(draft.followUpDue)}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Workflow timeline" description="A simple event trail for the job record.">
            <div className="stack">
              <div className="detail-card">
                <p className="detail-card__title">Discovered</p>
                <p className="detail-card__value">{formatCompactDateTime(job.discoveredAt)}</p>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">Current status</p>
                <p className="detail-card__value">{job.status.replaceAll('_', ' ')}</p>
              </div>
              <div className="detail-card">
                <p className="detail-card__title">Planned next step</p>
                <p className="detail-card__value">{job.nextAction}</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="stack">
          <SectionCard
            title="Update job"
            description="Keep the CRM state, notes, and follow-up dates current."
          >
            <JobEditPanel key={`${job.id}-${job.updatedAt ?? job.createdAt ?? ''}`} job={job} />
          </SectionCard>

          <SectionCard
            title="Manual approval policy"
            description="The product drafts and recommends, but never sends without review."
          >
            <ul className="list">
              <li>Status and priority changes are human-driven.</li>
              <li>Notes and follow-up dates are editable before any outreach is generated.</li>
              <li>AI analysis is available here, but the user still controls every downstream action.</li>
            </ul>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Related opportunities"
        description="A few other jobs in the same dataset that the user can compare."
      >
        <div className="grid grid--three">
          {relatedJobs.map((candidate) => (
            <Link key={candidate.id} href={`/jobs/${candidate.id}`} className="detail-card">
              <p className="detail-card__title">{candidate.company}</p>
              <p className="detail-card__value">{candidate.title}</p>
              <StatusPill status={candidate.status} />
            </Link>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
