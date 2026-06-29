import { Briefcase, FileBarChart, Plus, Send, Target, TimerReset } from 'lucide-react';
import Link from 'next/link';
import { FitScoreRing } from '@/components/fit-score-ring';
import { SectionCard } from '@/components/section-card';
import { StatTile } from '@/components/stat-tile';
import { StatusPill } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getDashboardSummary } from '@/lib/dashboard';
import { loadJobs } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard' };

const FUNNEL = [
  { key: 'discovered', label: 'Discovered', tone: 'bg-slate-400' },
  { key: 'shortlisted', label: 'Shortlisted', tone: 'bg-indigo-500' },
  { key: 'applied', label: 'Applied', tone: 'bg-emerald-500' },
  { key: 'interview', label: 'Interview', tone: 'bg-amber-500' },
  { key: 'offer', label: 'Offer', tone: 'bg-emerald-600' },
] as const;

export default async function DashboardPage() {
  const { jobs, source } = await loadJobs();
  const summary = getDashboardSummary(jobs);
  const recentJobs = [...jobs]
    .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
    .slice(0, 4);

  const outreachActive =
    summary.statusCounts.outreach_drafted + summary.statusCounts.outreach_sent;
  const maxSkill = Math.max(1, ...summary.topMissingSkills.map((s) => s.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground text-sm">
            Your AI job-search operations at a glance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button render={<Link href="/jobs/new" />} className="gap-1.5">
            <Plus className="size-4" /> Add job
          </Button>
          <Button
            render={<Link href="/reports" />}
            variant="outline"
            className="gap-1.5"
          >
            <FileBarChart className="size-4" /> Reports
          </Button>
        </div>
      </div>

      {source === 'seed' ? (
        <Card className="border-amber-500/30 bg-amber-500/5 gap-1 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Seed data shown</p>
          <p className="text-muted-foreground text-sm">
            The API is not reachable, so the dashboard is rendering local seed data. It switches to
            live CRM data automatically once the backend is up.
          </p>
        </Card>
      ) : null}

      {summary.totalJobs === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
            <Briefcase className="size-6" />
          </span>
          <div>
            <p className="font-heading text-lg font-semibold">No jobs yet</p>
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              Add a job (paste its description) and the AI will parse it, score your fit, and draft
              outreach. You can also load sample data from Settings to explore first.
            </p>
          </div>
          <div className="flex gap-2">
            <Button render={<Link href="/jobs/new" />} className="gap-1.5">
              <Plus className="size-4" /> Add your first job
            </Button>
            <Button render={<Link href="/settings" />} variant="outline">
              Load sample data
            </Button>
          </div>
        </Card>
      ) : null}

      {/* KPI tiles — real values only (no fabricated trend/sparkline history). */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Jobs tracked" value={summary.totalJobs} icon={Briefcase} />
        <StatTile label="Avg fit score" value={summary.averageFitScore} icon={Target} />
        <StatTile label="Outreach drafts" value={summary.outreachDrafts} icon={Send} />
        <StatTile label="Follow-ups due" value={summary.followUpsDue} icon={TimerReset} />
      </div>

      {/* Pipeline funnel */}
      <SectionCard title="Pipeline" description="Where your opportunities stand in the funnel.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {FUNNEL.map((stage) => (
            <div key={stage.key} className="bg-muted/40 rounded-xl p-3">
              <span className={`mb-2 block h-1.5 w-8 rounded-full ${stage.tone}`} />
              <p className="font-heading text-2xl font-bold tabular-nums">
                {summary.statusCounts[stage.key as keyof typeof summary.statusCounts] ?? 0}
              </p>
              <p className="text-muted-foreground text-xs">{stage.label}</p>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          {outreachActive} outreach in motion · {summary.statusCounts.rejected} closed out
        </p>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Recent jobs */}
        <SectionCard
          title="Recent activity"
          description="Latest opportunities in your pipeline."
          className="lg:col-span-3"
          action={
            <Button render={<Link href="/jobs" />} variant="ghost" size="sm">
              View all
            </Button>
          }
        >
          <ul className="divide-border -my-1 divide-y">
            {recentJobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors"
                >
                  <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
                    {job.company.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{job.title}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {job.company} · {job.location}
                    </p>
                  </div>
                  <StatusPill status={job.status} />
                  <FitScoreRing score={job.fitScore} size={40} strokeWidth={4} />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* Top missing skills */}
        <SectionCard
          title="Top missing skills"
          description="Most common gaps across your targets."
          className="lg:col-span-2"
        >
          <div className="space-y-3">
            {summary.topMissingSkills.map((skill) => (
              <div key={skill.skill} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{skill.skill}</span>
                  <span className="text-muted-foreground tabular-nums">{skill.count}</span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${Math.max(12, (skill.count / maxSkill) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {summary.topMissingSkills.length === 0 ? (
              <p className="text-muted-foreground text-sm">No skill gaps detected yet.</p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
