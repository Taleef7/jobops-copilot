import type { Metadata } from 'next';
import { CircleCheck, Download, Send, Target, Briefcase, CalendarCheck } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { SectionCard } from '@/components/section-card';
import { StatTile } from '@/components/stat-tile';
import { Card } from '@/components/ui/card';
import { loadJobs } from '@/lib/job-data';
import { loadWeeklyReports } from '@/lib/report-data';
import { getReportSnapshot } from '@/lib/report-snapshot';
import type { WeeklyReport } from '@/types/job';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reports' };

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const formatDate = (value: string) => dateFormatter.format(new Date(value));
const formatWeekRange = (report: WeeklyReport) =>
  `${formatDate(report.weekStart)} – ${formatDate(report.weekEnd)}`;

export default async function ReportsPage() {
  const [{ jobs, source }, { reports }] = await Promise.all([loadJobs(), loadWeeklyReports()]);
  const snapshot = getReportSnapshot(jobs);

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No report yet"
        description="Your weekly report is built from the jobs you track. Add a job — your discovered, applied, outreach, and interview figures will appear here automatically."
        actionLabel="Add your first job"
        actionHref="/jobs/new"
      />
    );
  }

  const topSkills = snapshot.commonMissingSkills.slice(0, 6);
  const maxSkill = Math.max(1, topSkills.length);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Weekly reports</h2>
        <p className="text-muted-foreground text-sm">A live snapshot of your pipeline.</p>
      </div>

      {source === 'seed' ? (
        <Card className="border-amber-500/30 bg-amber-500/5 gap-1 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Seed data shown</p>
          <p className="text-muted-foreground text-sm">
            The API is not reachable, so these figures come from local seed data. They switch to your
            live CRM automatically once the backend is up.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Discovered" value={snapshot.discovered} icon={Briefcase} />
        <StatTile label="Applied" value={snapshot.applied} icon={Target} />
        <StatTile label="Outreach sent" value={snapshot.outreachSent} icon={Send} />
        <StatTile label="Interviews" value={snapshot.interviews} icon={CalendarCheck} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Recommendations" description="Guidance derived from your live pipeline.">
          {snapshot.recommendations.length > 0 ? (
            <ul className="space-y-2.5">
              {snapshot.recommendations.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <CircleCheck className="text-primary mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No recommendations yet.</p>
          )}
        </SectionCard>

        <SectionCard title="Recurring missing skills" description="Repeated gaps across your targets.">
          {topSkills.length > 0 ? (
            <div className="space-y-3">
              {topSkills.map((skill, index) => (
                <div key={skill} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{skill}</span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${100 - (index / maxSkill) * 60}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No repeated skill gaps yet.</p>
          )}
        </SectionCard>
      </div>

      {reports.length > 0 ? (
        <SectionCard title="Report history" description="Saved reports in week order.">
          <ul className="divide-border -my-1 divide-y">
            {reports.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">{formatWeekRange(item)}</p>
                  <p className="text-muted-foreground text-xs">Generated {formatDate(item.createdAt)}</p>
                </div>
                <a
                  href={`/api/proxy/api/reports/${item.id}/export`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-primary flex items-center gap-1 text-sm"
                >
                  <Download className="size-4" /> Export
                </a>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
