'use client';

import {
  ArrowUpRight,
  BookmarkCheck,
  Building2,
  Clock,
  ExternalLink,
  MapPin,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FeedSubSignals } from '@/components/feed-sub-signals';
import { FitScoreRing } from '@/components/fit-score-ring';
import { StatusPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { updateJob } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FeedItem, JobStatus } from '@/types/job';

interface FeedCardProps {
  item: FeedItem;
  onStatusChange?: (jobId: string, newStatus: JobStatus) => void;
  className?: string;
}

function formatSalary(min?: number | null, max?: number | null, currency?: string | null) {
  if (!min && !max) return null;
  const curr = currency === 'USD' || !currency ? '$' : `${currency} `;
  const formatNum = (n: number) => (n >= 1000 ? `${curr}${Math.round(n / 1000)}k` : `${curr}${n}`);
  if (min && max && min !== max) return `${formatNum(min)} – ${formatNum(max)}`;
  if (min) return `From ${formatNum(min)}`;
  if (max) return `Up to ${formatNum(max)}`;
  return null;
}

function getFreshnessBadge(dateStr?: string) {
  if (!dateStr) return null;
  const postedMs = new Date(dateStr).getTime();
  if (Number.isNaN(postedMs)) return null;
  const diffHours = (Date.now() - postedMs) / (1000 * 60 * 60);

  if (diffHours <= 24) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-[11px] font-medium"
      >
        <Zap className="size-3 fill-current" />
        New today
      </Badge>
    );
  }
  if (diffHours <= 72) {
    return (
      <Badge
        variant="outline"
        className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400 gap-1 text-[11px] font-medium"
      >
        <Clock className="size-3" />
        Recent
      </Badge>
    );
  }
  return null;
}

export function FeedCard({ item, onStatusChange, className }: FeedCardProps) {
  const { job, fitScore, adjustedScore, subSignals, rankReasons } = item;
  const [currentStatus, setCurrentStatus] = useState<JobStatus>(job.status);
  const [isUpdating, setIsUpdating] = useState(false);

  const displayScore = adjustedScore ?? fitScore;
  const scoreDelta = adjustedScore != null && fitScore != null ? adjustedScore - fitScore : 0;
  const salaryText = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const freshnessBadge = getFreshnessBadge(job.datePosted ?? job.discoveredAt);

  async function handleStatusUpdate(newStatus: JobStatus) {
    setIsUpdating(true);
    try {
      await updateJob(job.id, { status: newStatus });
      setCurrentStatus(newStatus);
      onStatusChange?.(job.id, newStatus);
    } catch {
      // Revert if API fails
    } finally {
      setIsUpdating(false);
    }
  }

  const isShortlisted = currentStatus === 'shortlisted';
  const isApplied = currentStatus === 'applied' || currentStatus === 'interview' || currentStatus === 'offer';
  const isArchived = currentStatus === 'archived' || currentStatus === 'rejected';

  return (
    <Card
      className={cn(
        'group relative flex flex-col gap-4 p-5 transition-all hover:border-primary/40 hover:shadow-sm',
        isArchived && 'opacity-60',
        className,
      )}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-bold">
            {job.company.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <Link
              href={`/jobs/${job.id}`}
              className="group-hover:text-primary block font-heading text-lg font-semibold tracking-tight transition-colors hover:underline"
            >
              {job.title}
            </Link>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              <span className="flex items-center gap-1 font-medium text-foreground">
                <Building2 className="size-3.5 text-muted-foreground" />
                {job.company}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5 text-muted-foreground" />
                {job.location || 'Location not specified'}
              </span>
              {job.workplaceType && (
                <>
                  <span>·</span>
                  <span className="capitalize">{job.workplaceType}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Fit Score & Rank Delta */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-2">
            {scoreDelta !== 0 && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full border',
                  scoreDelta > 0
                    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400'
                    : 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-400',
                )}
                title={`Rank heuristic adjustment: ${scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta} points`}
              >
                {scoreDelta > 0 ? (
                  <>
                    <TrendingUp className="size-3" />+{scoreDelta}
                  </>
                ) : (
                  <>
                    <TrendingDown className="size-3" />
                    {scoreDelta}
                  </>
                )}
              </span>
            )}
            <FitScoreRing score={displayScore} size={50} strokeWidth={5} />
          </div>
          <span className="text-[10px] font-medium text-muted-foreground tracking-tight">
            {adjustedScore != null && fitScore != null && scoreDelta !== 0 ? 'Ranked fit' : 'Match fit'}
          </span>
        </div>
      </div>

      {/* Badges Bar: Freshness, Salary, Seniority, Sponsorship, Liveness */}
      <div className="flex flex-wrap items-center gap-2">
        {freshnessBadge}

        {salaryText && (
          <Badge variant="secondary" className="font-semibold text-xs text-foreground">
            {salaryText}
          </Badge>
        )}

        {job.seniority && (
          <Badge variant="outline" className="capitalize text-xs">
            {job.seniority}
          </Badge>
        )}

        {job.workplaceType && (
          <Badge variant="outline" className="capitalize text-xs">
            {job.workplaceType}
          </Badge>
        )}

        {(job.sponsorLikelihood === 'likely' ||
          (typeof job.sponsorLikelihood === 'object' &&
            job.sponsorLikelihood !== null &&
            job.sponsorLikelihood.status === 'known_sponsor')) && (
          <Badge
            variant="outline"
            className="border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300 text-xs"
          >
            H-1B Sponsor
          </Badge>
        )}

        {job.liveness === 'stale' && (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs"
          >
            Decaying posting
          </Badge>
        )}

        {job.liveness === 'expired' && (
          <Badge
            variant="outline"
            className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs"
          >
            Likely expired
          </Badge>
        )}

        {job.source && job.source !== 'manual' && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal capitalize">
            via {job.source}
          </Badge>
        )}

        <div className="ml-auto">
          <StatusPill status={currentStatus} />
        </div>
      </div>

      {/* Rank Reasons Explanations Callout */}
      {rankReasons && rankReasons.length > 0 && (
        <div className="rounded-lg bg-muted/40 px-3 py-2 border border-border/60">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 mb-1">
            <Sparkles className="size-3.5 text-primary" />
            <span>Why today&apos;s best:</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {rankReasons.map((reason, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <span className="text-primary font-bold">·</span>
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4 Sub-Signals Breakdown */}
      <FeedSubSignals subSignals={subSignals} />

      {/* Card Footer: Summary & Action Buttons */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
        <div className="text-xs text-muted-foreground">
          {job.datePosted ? `Posted ${formatDate(job.datePosted)}` : `Discovered ${formatDate(job.discoveredAt)}`}
        </div>

        <div className="flex items-center gap-2">
          {!isArchived && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isUpdating}
              onClick={() => handleStatusUpdate('archived')}
              className="text-muted-foreground hover:text-rose-600 gap-1 text-xs h-8"
            >
              <XCircle className="size-3.5" /> Pass
            </Button>
          )}

          {!isShortlisted && !isApplied && (
            <Button
              size="sm"
              variant="outline"
              disabled={isUpdating}
              onClick={() => handleStatusUpdate('shortlisted')}
              className="gap-1 text-xs h-8 font-medium"
            >
              <BookmarkCheck className="size-3.5 text-primary" /> Shortlist
            </Button>
          )}

          {isShortlisted && (
            <Badge variant="outline" className="border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 text-xs">
              ✓ Shortlisted
            </Badge>
          )}

          {job.jobUrl && (
            <Button
              size="sm"
              variant="ghost"
              render={<a href={job.jobUrl} target="_blank" rel="noopener noreferrer" />}
              className="gap-1 text-xs h-8 text-muted-foreground"
            >
              <ExternalLink className="size-3.5" /> Source
            </Button>
          )}

          <Button
            size="sm"
            variant="default"
            render={<Link href={`/jobs/${job.id}`} />}
            className="gap-1 text-xs h-8 font-semibold"
          >
            Review role <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
