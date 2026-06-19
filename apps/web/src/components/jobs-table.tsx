'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FitScoreRing } from '@/components/fit-score-ring';
import { StatusPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Job, JobPriority, JobStatus } from '@/types/job';

const statusOptions: Array<JobStatus | 'all'> = [
  'all',
  'discovered',
  'shortlisted',
  'outreach_drafted',
  'outreach_sent',
  'referral_requested',
  'follow_up_due',
  'applied',
  'interview',
  'offer',
  'rejected',
  'archived',
];

const priorityOptions: Array<JobPriority | 'all'> = ['all', 'high', 'medium', 'low'];

const priorityTone: Record<JobPriority, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
};

const selectClass =
  'border-input bg-card h-9 rounded-md border px-2.5 text-sm capitalize shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none';

export function JobsTable({ jobs }: { jobs: Job[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const [priority, setPriority] = useState<JobPriority | 'all'>('all');

  const hasJobs = jobs.length > 0;
  const normalizedQuery = query.trim().toLowerCase();

  const filteredJobs = jobs.filter((job) => {
    const matchesQuery =
      !normalizedQuery ||
      [job.company, job.title, job.location, job.status, job.priority, job.notes ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    const matchesStatus = status === 'all' || job.status === status;
    const matchesPriority = priority === 'all' || job.priority === priority;
    return matchesQuery && matchesStatus && matchesPriority;
  });

  return (
    <div className="space-y-4">
      {/* No filter controls when there is nothing to filter. */}
      {hasJobs ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company, title, location…"
              aria-label="Search jobs"
              className="bg-card pl-8"
            />
          </div>
          <select
            aria-label="Filter by status"
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as JobStatus | 'all')}
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All statuses' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by priority"
            className={selectClass}
            value={priority}
            onChange={(event) => setPriority(event.target.value as JobPriority | 'all')}
          >
            {priorityOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All priorities' : option}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!hasJobs ? (
        <EmptyState
          title="No jobs yet"
          description="Add a job (paste its description) and the AI will parse it, score your fit, and draft outreach. You can also load sample data from Settings to explore first."
          actionLabel="Add your first job"
          actionHref="/jobs/new"
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          title="No matching jobs"
          description="Try a different company, title, status, or priority filter."
          actionLabel="Add a job"
          actionHref="/jobs/new"
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company &amp; role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Fit</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="hidden md:table-cell">Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((job) => (
                <TableRow key={job.id} className="group">
                  <TableCell>
                    <Link href={`/jobs/${job.id}`} className="flex items-center gap-3">
                      <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
                        {job.company.slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="group-hover:text-primary block truncate font-medium transition-colors">
                          {job.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {job.company} · {job.location}
                        </span>
                        {job.source === 'adzuna' || job.source === 'remotive' ? (
                          <Badge variant="outline" className="mt-1 text-[10px] font-normal capitalize">
                            via {job.source}
                          </Badge>
                        ) : null}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusPill status={job.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-center">
                      <FitScoreRing score={job.fitScore} size={38} strokeWidth={4} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm capitalize">
                      <span className={cn('size-2 rounded-full', priorityTone[job.priority])} />
                      {job.priority}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-[16rem] truncate text-sm md:table-cell">
                    {job.nextAction || formatDate(job.nextActionDue ?? job.discoveredAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {hasJobs ? (
        <p className="text-muted-foreground text-xs">
          Showing {filteredJobs.length} of {jobs.length} jobs
        </p>
      ) : null}
    </div>
  );
}
