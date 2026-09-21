'use client';

import { RotateCcw, Search } from 'lucide-react';
import { OptionSelect, type SelectOption } from '@/components/ui/option-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { JobSeniority, JobStatus, WorkplaceType } from '@/types/job';

export interface FeedFilterState {
  query: string;
  minScore: string; // 'all' | '60' | '70' | '80' | '90'
  seniority: JobSeniority | 'all';
  sponsorOnly: 'all' | 'sponsor_only';
  workplaceType: WorkplaceType | 'all';
  status: JobStatus | 'all';
}

interface FeedFiltersProps {
  filters: FeedFilterState;
  onChange: (filters: FeedFilterState) => void;
  onReset: () => void;
  className?: string;
}

const minScoreOptions: readonly SelectOption<string>[] = [
  { value: 'all', label: 'All Fit Scores' },
  { value: '60', label: 'Fit 60%+' },
  { value: '70', label: 'Fit 70%+' },
  { value: '80', label: 'Fit 80%+' },
  { value: '90', label: 'Fit 90%+' },
];

const seniorityOptions: readonly SelectOption<JobSeniority | 'all'>[] = [
  { value: 'all', label: 'All Seniority' },
  { value: 'junior', label: 'Junior / Entry' },
  { value: 'mid', label: 'Mid Level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead / Staff' },
  { value: 'unknown', label: 'Other' },
];

const sponsorOptions: readonly SelectOption<'all' | 'sponsor_only'>[] = [
  { value: 'all', label: 'All Sponsorship' },
  { value: 'sponsor_only', label: 'H-1B Sponsor Only' },
];

const workplaceOptions: readonly SelectOption<WorkplaceType | 'all'>[] = [
  { value: 'all', label: 'All Workplaces' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];

const statusOptions: readonly SelectOption<JobStatus | 'all'>[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'discovered', label: 'Discovered' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
];

export function FeedFilters({ filters, onChange, onReset, className }: FeedFiltersProps) {
  const isFiltered =
    filters.query !== '' ||
    filters.minScore !== 'all' ||
    filters.seniority !== 'all' ||
    filters.sponsorOnly !== 'all' ||
    filters.workplaceType !== 'all' ||
    filters.status !== 'all';

  return (
    <div className={cn('space-y-3', className)}>
      {/* Primary search row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Filter Today's Best by title, company, or skills..."
            aria-label="Filter Today's Best"
            className="bg-card pl-8"
          />
        </div>

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-9 gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            <RotateCcw className="size-3.5" />
            Reset filters
          </Button>
        )}
      </div>

      {/* Granular filter dropdowns */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <OptionSelect
          aria-label="Filter by minimum score"
          value={filters.minScore}
          onValueChange={(val) => onChange({ ...filters, minScore: val })}
          options={minScoreOptions}
          size="sm"
        />

        <OptionSelect
          aria-label="Filter by seniority"
          value={filters.seniority}
          onValueChange={(val) => onChange({ ...filters, seniority: val })}
          options={seniorityOptions}
          size="sm"
        />

        <OptionSelect
          aria-label="Filter by sponsorship"
          value={filters.sponsorOnly}
          onValueChange={(val) => onChange({ ...filters, sponsorOnly: val })}
          options={sponsorOptions}
          size="sm"
        />

        <OptionSelect
          aria-label="Filter by workplace type"
          value={filters.workplaceType}
          onValueChange={(val) => onChange({ ...filters, workplaceType: val })}
          options={workplaceOptions}
          size="sm"
        />

        <OptionSelect
          aria-label="Filter by pipeline status"
          value={filters.status}
          onValueChange={(val) => onChange({ ...filters, status: val })}
          options={statusOptions}
          size="sm"
        />
      </div>
    </div>
  );
}
