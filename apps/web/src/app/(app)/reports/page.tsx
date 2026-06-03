import type { Metadata } from 'next';
import { CircleCheck, Download } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { SectionCard } from '@/components/section-card';
import { StatTile } from '@/components/stat-tile';
import { loadWeeklyReports } from '@/lib/report-data';
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

// Percentage change vs the previous week (null when there's no prior report).
function weekOverWeek(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined) return undefined;
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export default async function ReportsPage() {
  const { reports } = await loadWeeklyReports();
  const report = reports[0];
  const prior = reports[1];

  if (!report) {
    return (
      <EmptyState
        title="No weekly report yet"
        description="Once the reporting workflow runs, the latest weekly summary will appear here."
        actionLabel="Back to dashboard"
        actionHref="/dashboard"
      />
    );
  }

  const maxSkill = Math.max(1, report.commonMissingSkills.length);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Weekly reports</h2>
        <p className="text-muted-foreground text-sm">
          Latest snapshot · {formatWeekRange(report)}
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Discovered"
          value={report.jobsDiscovered}
          trend={weekOverWeek(report.jobsDiscovered, prior?.jobsDiscovered)}
          trendLabel="week over week"
        />
        <StatTile
          label="Applied"
          value={report.jobsApplied}
          trend={weekOverWeek(report.jobsApplied, prior?.jobsApplied)}
          trendLabel="week over week"
        />
        <StatTile
          label="Outreach sent"
          value={report.outreachSent}
          trend={weekOverWeek(report.outreachSent, prior?.outreachSent)}
          trendLabel="week over week"
        />
        <StatTile
          label="Interviews"
          value={report.interviews}
          trend={weekOverWeek(report.interviews, prior?.interviews)}
          trendLabel="week over week"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Recommendations" description="Actionable guidance from this week's report.">
          <ul className="space-y-2.5">
            {report.recommendations.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <CircleCheck className="text-primary mt-0.5 size-4 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Recurring missing skills" description="Repeated gaps across the funnel.">
          <div className="space-y-3">
            {report.commonMissingSkills.map((skill, index) => (
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
        </SectionCard>
      </div>

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
    </div>
  );
}
