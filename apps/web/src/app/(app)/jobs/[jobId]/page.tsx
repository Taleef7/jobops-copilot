import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FitScoreRing } from '@/components/fit-score-ring';
import { JobAgentsPanel } from '@/components/job-agents-panel';
import { JobAnalysisActions } from '@/components/job-analysis-actions';
import { JobEditPanel } from '@/components/job-edit-panel';
import { JobOutreachActions } from '@/components/job-outreach-actions';
import { SkillChipList } from '@/components/skill-chip';
import { StatusPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAgentOutputs, fetchProfile } from '@/lib/api';
import { isHeuristicAnalysis, isPrerankAnalysis } from '@/lib/analysis-display';
import { formatDate } from '@/lib/format';
import { loadJob } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

type JobDetailParams = { params: Promise<{ jobId: string }> };

export async function generateMetadata({ params }: JobDetailParams): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = await loadJob(jobId);
  return { title: job ? `${job.company} · ${job.title}` : 'Job detail' };
}

export default async function JobDetailPage({ params }: JobDetailParams) {
  const { jobId } = await params;
  // Fetch the profile + persisted agent outputs alongside the job. Neither is
  // load-bearing for the page, so a failure of either must not break it.
  const [{ job, source }, profile, agentOutputs] = await Promise.all([
    loadJob(jobId),
    fetchProfile().catch(() => null),
    fetchAgentOutputs(jobId).catch(() => []),
  ]);
  if (!job) notFound();

  // Surface a rule-based heuristic score plainly (QA·B); see isHeuristicAnalysis.
  const heuristic = isHeuristicAnalysis(job.analysis.modelUsed);
  // Only auto-upgrade an estimated (local-prerank) job when a resume is on file:
  // without one, /score-fit returns 400 *after* the budget guard reserves cost,
  // so auto-firing on every open would silently drain the daily AI budget.
  const estimated = isPrerankAnalysis(job.analysis.modelUsed);
  const autoScore = estimated && profile?.hasResume === true;

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
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={job.status} />
              <Badge variant="outline" className="capitalize">{job.location}</Badge>
              <Badge variant="outline" className="capitalize">{job.workplaceType}</Badge>
              <Badge variant="outline" className="capitalize">{job.employmentType}</Badge>
              <Badge variant="outline" className="capitalize">{job.priority} priority</Badge>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <FitScoreRing score={job.fitScore} size={72} strokeWidth={7} />
            <span className="text-muted-foreground text-xs">Fit score</span>
          </div>
        </div>
        <div className="border-t pt-4">
          <JobAnalysisActions jobId={job.id} autoScore={autoScore} />
        </div>
      </Card>

      {source === 'seed' ? (
        <Card className="border-amber-500/30 bg-amber-500/5 gap-1 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Seed data shown</p>
          <p className="text-muted-foreground text-sm">
            The backend is not reachable, so this page renders the local seed record.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main: tabbed content */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="analysis" className="gap-4">
            <TabsList>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="agents">AI agents</TabsTrigger>
              <TabsTrigger value="outreach">Outreach</TabsTrigger>
            </TabsList>

            <TabsContent value="analysis" className="space-y-4">
              {heuristic ? (
                <Card className="border-amber-500/30 bg-amber-500/5 gap-1 p-4">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Heuristic estimate — not a full AI assessment
                  </p>
                  <p className="text-muted-foreground text-sm">
                    The AI model wasn&apos;t available (it may have been warming up), so this is a
                    rule-based fallback. Re-run the analysis in a moment for a real model review.
                  </p>
                </Card>
              ) : null}
              <Card className="gap-4 p-5">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Confidence {job.analysis.confidenceScore}</Badge>
                  <Badge variant={heuristic ? 'outline' : 'secondary'}>
                    {heuristic ? 'Heuristic fallback' : `Model: ${job.analysis.modelUsed}`}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                    Fit summary
                  </p>
                  <p className="text-sm leading-relaxed">{job.analysis.fitSummary}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                    Recommended resume angle
                  </p>
                  <p className="text-sm leading-relaxed">{job.analysis.recommendedResumeAngle}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      Matched skills
                    </p>
                    <SkillChipList items={job.analysis.matchedSkills} variant="matched" empty="None matched yet." />
                  </div>
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      Missing skills
                    </p>
                    <SkillChipList items={job.analysis.missingSkills} variant="missing" empty="None missing." />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    ATS keywords
                  </p>
                  <SkillChipList items={job.analysis.atsKeywords} empty="Not parsed yet." />
                </div>
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-muted-foreground mb-0.5 text-xs">Apply recommendation</p>
                  <p className="text-sm">{job.analysis.applyRecommendation}</p>
                </div>
              </Card>
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
                  disabled={source === 'seed'}
                />
              </Card>
              {job.outreach.length ? (
                <Card className="gap-3 p-5">
                  {/* h2 (not h3) so the document heading order doesn't skip a level (a11y). */}
                  <h2 className="font-heading text-sm font-semibold">Saved draft</h2>
                  {/* Only the latest draft is kept; slice defends against any legacy rows. */}
                  {job.outreach.slice(-1).map((draft) => (
                    <div key={draft.id} className="bg-muted/40 space-y-2 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {draft.contactName || 'Contact'} · {draft.contactRole || draft.messageType.replaceAll('_', ' ')}
                        </p>
                        <StatusPill status={draft.status} />
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{draft.draftText}</p>
                    </div>
                  ))}
                </Card>
              ) : null}
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
                <dd>{formatDate(job.datePosted)}</dd>
              </div>
              <div className="flex justify-between gap-2 border-b py-2">
                <dt className="text-muted-foreground">Next action</dt>
                <dd className="text-right">{job.nextAction || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2 py-2">
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd>{job.nextActionDue ? formatDate(job.nextActionDue) : '—'}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
