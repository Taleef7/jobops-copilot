import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FitScoreRing } from '@/components/fit-score-ring';
import { JobAgentsPanel } from '@/components/job-agents-panel';
import { JobAnalysisCard } from '@/components/job-analysis-card';
import { JobAnalysisActions } from '@/components/job-analysis-actions';
import { JobEditPanel } from '@/components/job-edit-panel';
import { JobOutreachActions } from '@/components/job-outreach-actions';
import { LoadFailure } from '@/components/load-failure';
import { LocalDate } from '@/components/local-date';
import { SavedOutreachDraft } from '@/components/saved-outreach-draft';
import { StatusPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApplicationPackView } from '@/components/application-pack-view';
import { JobContactsPanel } from '@/components/job-contacts-panel';
import { TailoredResumeReview } from '@/components/tailored-resume-review';
import {
  fetchAgentOutputs,
  fetchJobApplicationPack,
  fetchJobContacts,
  fetchJobResumeVersions,
  fetchProfile,
} from '@/lib/api';
import { isPrerankAnalysis } from '@/lib/analysis-display';
import { postedDay } from '@/lib/format';
import { isJobId, loadJob } from '@/lib/job-data';
import { isDuplicateRemote, postingHref } from '@/lib/job-display';

export const dynamic = 'force-dynamic';

type JobDetailParams = { params: Promise<{ jobId: string }> };
type JobDetailProps = JobDetailParams & { searchParams?: Promise<{ run?: string | string[] }> };

export async function generateMetadata({ params }: JobDetailParams): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = isJobId(jobId) ? await loadJob(jobId) : { job: undefined };
  return { title: job ? `${job.company} · ${job.title}` : 'Job detail' };
}

export default async function JobDetailPage({ params, searchParams }: JobDetailProps) {
  const { jobId } = await params;
  // "Save and run fit" on the Add job form opens the job with ?run=fit (#355).
  const runFit = (await searchParams)?.run === 'fit';
  // A malformed id names no job, so say so without asking the API (#353).
  if (!isJobId(jobId)) notFound();
  // Fetch the profile + persisted agent outputs alongside the job. Neither is
  // load-bearing for the page, so a failure of either must not break it.
  const [{ job, error }, profile, agentOutputs, resumeVersions, applicationPack, contacts] = await Promise.all([
    loadJob(jobId),
    fetchProfile().catch(() => null),
    fetchAgentOutputs(jobId).catch(() => []),
    fetchJobResumeVersions(jobId).catch(() => []),
    fetchJobApplicationPack(jobId).catch(() => null),
    fetchJobContacts(jobId).catch(() => []),
  ]);
  if (error) return <LoadFailure heading="Job detail" title="Couldn't load this job" message={error} />;
  if (!job) notFound();

  // Null until a real fit score succeeds (#349).
  const analysis = job.analysis;
  // Only auto-upgrade an estimated (local-prerank) job when a resume is on file:
  // without one, /score-fit returns 400 *after* the budget guard reserves cost,
  // so auto-firing on every open would silently drain the daily AI budget.
  const estimated = isPrerankAnalysis(analysis?.modelUsed);
  const autoScore = estimated && profile?.hasResume === true;
  const posting = postingHref(job.jobUrl);

  return (
    <div className="space-y-6">
      <Button render={<Link href="/jobs" />} variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <ArrowLeft className="size-4" /> Back to jobs
      </Button>

      {/* Summary header */}
      <Card className="gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{job.title}</h1>
            <p className="text-muted-foreground">{job.company}</p>
            {posting ? (
              <a
                href={posting}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-block text-sm font-medium hover:underline"
              >
                Open posting <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={job.status} />
              {/* What the posting doesn't state is left out, not filled in (#355). */}
              {job.location.trim() && !isDuplicateRemote(job.location, job.workplaceType) ? (
                <Badge variant="outline" className="capitalize">{job.location}</Badge>
              ) : null}
              {job.workplaceType ? (
                <Badge variant="outline" className="capitalize">{job.workplaceType}</Badge>
              ) : null}
              {job.employmentType.trim() ? (
                <Badge variant="outline" className="capitalize">{job.employmentType}</Badge>
              ) : null}
              <Badge variant="outline" className="capitalize">{job.priority} priority</Badge>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <FitScoreRing score={job.fitScore} size={72} strokeWidth={7} />
            <span className="text-muted-foreground text-xs">Fit score</span>
          </div>
        </div>
        <div className="border-t pt-4">
          {/* Keyed so each job gets its own one-at-a-time Score fit guard (#353). */}
          <JobAnalysisActions key={job.id} jobId={job.id} autoScore={autoScore} runFit={runFit} />
        </div>
      </Card>


      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main: tabbed content */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="analysis" className="gap-4">
            <TabsList>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="resume">Resume studio</TabsTrigger>
              <TabsTrigger value="apply-pack">Apply pack</TabsTrigger>
              <TabsTrigger value="people">People</TabsTrigger>
              <TabsTrigger value="agents">AI agents</TabsTrigger>
              <TabsTrigger value="outreach">Outreach</TabsTrigger>
            </TabsList>

            <TabsContent value="analysis" className="space-y-4">
              {!analysis ? (
                <Card className="gap-1 p-5">
                  <p className="text-sm font-medium">Not analysed yet</p>
                  <p className="text-muted-foreground text-sm">
                    Run Score fit to see how your résumé fits this role.
                  </p>
                </Card>
              ) : (
                <JobAnalysisCard analysis={analysis} />
              )}
            </TabsContent>

            <TabsContent value="resume" className="space-y-4">
              <TailoredResumeReview
                jobId={job.id}
                jobTitle={job.title}
                jobCompany={job.company}
                initialVersions={resumeVersions}
              />
            </TabsContent>

            <TabsContent value="agents">
              <Card className="p-5">
                <JobAgentsPanel jobId={job.id} initialOutputs={agentOutputs} />
              </Card>
            </TabsContent>

            <TabsContent value="outreach" className="space-y-4">
              <Card className="p-5">
                <JobOutreachActions
                  jobId={job.id}
                  jobContext={job.descriptionText}
                />
              </Card>
              {job.outreach.length ? (
                <Card className="gap-3 p-5">
                  {/* h2 (not h3) so the document heading order doesn't skip a level (a11y). */}
                  <h2 className="font-heading text-sm font-semibold">Saved draft</h2>
                  {/* Only the latest draft is kept; slice defends against any legacy rows. */}
                  {job.outreach.slice(-1).map((draft) => (
                    <SavedOutreachDraft
                      key={draft.id}
                      draft={draft}
                      company={job.company}
                      candidateName={resumeVersions[0]?.structuredResume?.basics?.name}
                    />
                  ))}
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="apply-pack" className="space-y-4">
              <ApplicationPackView
                jobId={job.id}
                company={job.company}
                initialPack={applicationPack}
                hasResume={profile?.hasResume}
              />
            </TabsContent>

            <TabsContent value="people" className="space-y-4">
              <Card className="p-5">
                <JobContactsPanel
                  jobId={job.id}
                  company={job.company}
                  initialContacts={contacts}
                />
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <Card className="gap-4 p-5">
            <h2 className="font-heading text-base font-semibold">Update job</h2>
            <JobEditPanel key={`${job.id}-${job.updatedAt ?? job.createdAt ?? ''}`} job={job} />
          </Card>

          <Card className="gap-2 p-5">
            <h2 className="font-heading text-base font-semibold">Snapshot</h2>
            <dl className="text-sm">
              <div className="flex justify-between gap-2 border-b py-2">
                <dt className="text-muted-foreground">Posted</dt>
                <dd><LocalDate value={postedDay(job.datePosted)} /></dd>
              </div>
              <div className="flex justify-between gap-2 border-b py-2">
                <dt className="text-muted-foreground">Next action</dt>
                <dd className="text-right">{job.nextAction || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2 py-2">
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd>{job.nextActionDue ? <LocalDate value={job.nextActionDue} /> : '—'}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
