'use client';

import { Award, Briefcase, DollarSign, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobAnalysisSubSignals } from '@/types/job';

interface FeedSubSignalsProps {
  subSignals?: JobAnalysisSubSignals;
  className?: string;
}

function getTone(value: number) {
  if (value >= 80) return 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30 dark:text-emerald-400';
  if (value >= 60) return 'text-sky-700 bg-sky-500/10 border-sky-500/30 dark:text-sky-400';
  if (value >= 40) return 'text-amber-700 bg-amber-500/10 border-amber-500/30 dark:text-amber-400';
  return 'text-muted-foreground bg-muted border-border';
}

export function FeedSubSignals({ subSignals, className }: FeedSubSignalsProps) {
  if (!subSignals) return null;

  const signals = [
    {
      id: 'skills',
      label: 'Skills',
      value: Math.round(subSignals.skills_match ?? subSignals.skillsMatch ?? 0),
      icon: Award,
    },
    {
      id: 'seniority',
      label: 'Role Fit',
      value: Math.round(subSignals.title_seniority ?? subSignals.titleSeniority ?? 0),
      icon: Briefcase,
    },
    {
      id: 'salary',
      label: 'Salary Fit',
      value: Math.round(subSignals.salary_fit ?? subSignals.salaryFit ?? 0),
      icon: DollarSign,
    },
    {
      id: 'sponsor',
      label: 'Sponsorship',
      value: Math.round(subSignals.sponsorship_likelihood ?? subSignals.sponsorshipLikelihood ?? 0),
      icon: Globe,
    },
  ];

  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)} aria-label="Sub-signal score breakdown">
      {signals.map((sig) => {
        const Icon = sig.icon;
        const tone = getTone(sig.value);
        return (
          <div
            key={sig.id}
            className={cn(
              'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              tone,
            )}
            title={`${sig.label}: ${sig.value}%`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{sig.label}</span>
            </span>
            <span className="font-semibold tabular-nums ml-1">{sig.value}%</span>
          </div>
        );
      })}
    </div>
  );
}
