'use client';

import { Award, Briefcase, DollarSign, Globe } from 'lucide-react';
import { signalLabel } from '@/lib/analysis-display';
import { cn } from '@/lib/utils';
import type { JobAnalysisSubSignals } from '@/types/job';

interface FeedSubSignalsProps {
  subSignals?: JobAnalysisSubSignals;
  className?: string;
}

/** A number, or null when nothing measured the signal: it shows "unknown" (#354). */
function measured(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function getTone(value: number | null) {
  if (value == null) return 'text-muted-foreground bg-muted border-border';
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
      value: measured(subSignals.skills_match ?? subSignals.skillsMatch),
      icon: Award,
    },
    {
      id: 'seniority',
      label: 'Role Fit',
      value: measured(subSignals.title_seniority ?? subSignals.titleSeniority),
      icon: Briefcase,
    },
    {
      id: 'salary',
      label: 'Salary Fit',
      value: measured(subSignals.salary_fit ?? subSignals.salaryFit),
      icon: DollarSign,
    },
    {
      id: 'sponsor',
      label: 'Sponsorship',
      value: measured(subSignals.sponsorship_likelihood ?? subSignals.sponsorshipLikelihood),
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
              'relative flex items-center justify-between overflow-hidden rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              tone,
            )}
            title={`${sig.label}: ${signalLabel(sig.value)}`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{sig.label}</span>
            </span>
            <span className="font-semibold tabular-nums ml-1">{signalLabel(sig.value)}</span>
            {sig.value != null ? (
              <span
                className="absolute bottom-0 left-0 h-0.5 bg-current opacity-40 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, sig.value))}%` }}
                aria-hidden
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
