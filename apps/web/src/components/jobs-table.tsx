'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDate } from '@/lib/format';
import type { Job, JobPriority, JobStatus } from '@/types/job';
import { StatusPill } from '@/components/status-pill';
import { EmptyState } from '@/components/empty-state';

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

export function JobsTable({ jobs }: { jobs: Job[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const [priority, setPriority] = useState<JobPriority | 'all'>('all');

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
    <div className="job-table">
      <div className="job-table__toolbar">
        <label className="search-field">
          <span className="search-field__label">Search jobs</span>
          <input
            className="search-field__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company, title, location, or skill"
          />
        </label>

        <div className="filter-group">
          <span className="search-field__label">Status</span>
          <div className="filter-row">
            {statusOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`filter-chip${status === option ? ' filter-chip--active' : ''}`}
                onClick={() => setStatus(option)}
              >
                {option === 'all' ? 'All' : option.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="search-field__label">Priority</span>
          <div className="filter-row">
            {priorityOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`filter-chip${priority === option ? ' filter-chip--active' : ''}`}
                onClick={() => setPriority(option)}
              >
                {option === 'all' ? 'All' : option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <EmptyState
          title="No matching jobs"
          description="Try a different company, title, status, or priority filter."
          actionLabel="Add a job"
          actionHref="/jobs/new"
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Fit</th>
                <th>Next action</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="table-link" href={`/jobs/${job.id}`}>
                      <strong>{job.title}</strong>
                      <span>{job.company}</span>
                      <small>{job.location}</small>
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={job.status} />
                  </td>
                  <td>
                    <span className={`priority-pill priority-pill--${job.priority}`}>{job.priority}</span>
                  </td>
                  <td>
                    <strong>{job.fitScore ?? '—'}</strong>
                  </td>
                  <td>
                    <span className="table-copy">{job.nextAction ?? 'No next action yet.'}</span>
                  </td>
                  <td>
                    <span className="table-copy">{formatDate(job.nextActionDue ?? job.discoveredAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
