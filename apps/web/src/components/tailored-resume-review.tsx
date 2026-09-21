'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  GraduationCap,
  Lightbulb,
  Loader2,
  Lock,
  MinusCircle,
  PlusCircle,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  approveResumeVersion,
  downloadResumeVersion,
  rejectResumeVersion,
  tailorResumeForJob,
} from '@/lib/api';
import type { ResumeChangeDetail, ResumeVersionRecord } from '@/types/job';

interface TailoredResumeReviewProps {
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  initialVersions?: ResumeVersionRecord[];
}

export function TailoredResumeReview({
  jobId,
  jobTitle,
  jobCompany,
  initialVersions = [],
}: TailoredResumeReviewProps) {
  const [versions, setVersions] = useState<ResumeVersionRecord[]>(initialVersions);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    initialVersions.length > 0 ? initialVersions[0]!.id : null,
  );
  const [isTailoring, setIsTailoring] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [showFullResume, setShowFullResume] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentVersion =
    versions.find((v) => v.id === selectedVersionId) ?? (versions.length > 0 ? versions[0] : null);

  async function handleTailor() {
    setIsTailoring(true);
    setError(null);
    try {
      const newVersion = await tailorResumeForJob(jobId);
      setVersions((prev) => [newVersion, ...prev]);
      setSelectedVersionId(newVersion.id);
      setShowRejectForm(false);
      toast.success('Tailored resume draft generated successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to tailor resume.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsTailoring(false);
    }
  }

  async function handleApprove() {
    if (!currentVersion) return;
    setIsApproving(true);
    setError(null);
    try {
      const { version: updated } = await approveResumeVersion(currentVersion.id);
      setVersions((prev) =>
        prev.map((v) => (v.id === updated.id ? { ...v, approved: true } : v)),
      );
      toast.success('Resume version approved! ATS PDF is now unlocked for download.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve resume version.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsApproving(false);
    }
  }

  async function handleReject() {
    if (!currentVersion) return;
    if (!rejectFeedback.trim()) {
      toast.error('Please enter feedback explaining why you are rejecting this draft.');
      return;
    }
    setIsRejecting(true);
    setError(null);
    try {
      const { version: updated } = await rejectResumeVersion(currentVersion.id, rejectFeedback.trim());
      setVersions((prev) =>
        prev.map((v) => (v.id === updated.id ? { ...v, changeSummary: updated.changeSummary } : v)),
      );
      setShowRejectForm(false);
      setRejectFeedback('');
      toast.success('Feedback recorded. You can re-tailor or adjust your base resume.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record rejection feedback.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsRejecting(false);
    }
  }

  async function handleDownload() {
    if (!currentVersion) return;
    if (!currentVersion.approved) {
      toast.error('This version must be approved before downloading the ATS PDF.');
      return;
    }
    setIsDownloading(true);
    try {
      const candidateName = currentVersion.structuredResume?.basics?.name || 'Resume';
      const cleanName = candidateName.replace(/\s+/g, '_');
      const filename = `${cleanName}_${jobCompany.replace(/\s+/g, '_')}_Tailored.pdf`;
      await downloadResumeVersion(currentVersion.id, filename);
      toast.success('ATS PDF downloaded successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed.';
      toast.error(msg);
    } finally {
      setIsDownloading(false);
    }
  }

  // --- EMPTY STATE ---
  if (!currentVersion) {
    return (
      <Card className="flex flex-col items-center gap-6 p-8 text-center sm:p-10">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl ring-8 ring-primary/5">
          <Sparkles className="size-7" />
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="font-heading text-xl font-bold tracking-tight">Tailored Resume Studio</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Generate an ATS-optimized, job-targeted resume tailored specifically for{' '}
            <span className="font-semibold text-foreground">{jobTitle}</span> at{' '}
            <span className="font-semibold text-foreground">{jobCompany}</span>.
          </p>
        </div>

        <div className="grid w-full max-w-lg gap-3 text-left sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">Zero Invented Facts</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Grounded strictly in your verified base resume with zero hallucinated credentials.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">Diff & Rationale</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Inspect exactly what changed and why before approving or exporting.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">ATS Keyword Alignment</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Aligns phrasing to match the target job description and scanning algorithms.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">Deterministic PDF Export</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Clean single-column standard layout guaranteed readable by all major ATS parsers.
            </p>
          </div>
        </div>

        {error ? (
          <div className="w-full max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-xs text-destructive">
            <p className="font-medium">Error tailoring resume:</p>
            <p className="mt-0.5">{error}</p>
            {error.toLowerCase().includes('base resume') ? (
              <p className="mt-2">
                <Link href="/settings" className="font-semibold underline underline-offset-2 hover:opacity-80">
                  Open Settings to set up your Base Resume &rarr;
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        <Button
          onClick={handleTailor}
          disabled={isTailoring}
          size="lg"
          className="gap-2 shadow-sm"
        >
          {isTailoring ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Tailoring resume for this role...
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Tailor Resume for {jobCompany}
            </>
          )}
        </Button>
      </Card>
    );
  }

  // --- VERSION VIEW ---
  const changes: ResumeChangeDetail[] = currentVersion.changeDetails ?? [];

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <Card className="gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-bold tracking-tight">Tailored Resume</h2>
              {currentVersion.approved ? (
                <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> Approved & Ready
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <Clock className="size-3" /> Draft · Pending Review
                </Badge>
              )}
              {currentVersion.groundednessScore != null && (
                <Badge variant="secondary" className="text-xs">
                  Groundedness: {Math.round(currentVersion.groundednessScore * 100)}%
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              Optimized for <span className="font-medium text-foreground">{jobTitle}</span> at{' '}
              <span className="font-medium text-foreground">{jobCompany}</span> · Created{' '}
              {new Date(currentVersion.createdAt).toLocaleDateString()}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Gated Download Button */}
            {currentVersion.approved ? (
              <Button
                onClick={handleDownload}
                disabled={isDownloading}
                className="gap-2 bg-primary text-primary-foreground shadow-sm"
              >
                {isDownloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Download ATS PDF
              </Button>
            ) : (
              <div className="relative group">
                <Button
                  disabled
                  variant="outline"
                  className="gap-2 cursor-not-allowed opacity-60"
                  aria-label="Download PDF locked until approved"
                >
                  <Lock className="size-3.5" />
                  Download ATS PDF
                </Button>
                <div className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow border">
                  Approve this version to unlock PDF download
                </div>
              </div>
            )}

            {/* Approval Workflow */}
            {!currentVersion.approved && (
              <>
                <Button
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isApproving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Approve Resume
                </Button>
                <Button
                  onClick={() => setShowRejectForm(!showRejectForm)}
                  variant="outline"
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <XCircle className="size-3.5" />
                  Reject
                </Button>
              </>
            )}

            {/* Re-tailor */}
            <Button
              onClick={handleTailor}
              disabled={isTailoring}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              {isTailoring ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Re-tailor
            </Button>
          </div>
        </div>

        {/* Version Switcher if multiple versions */}
        {versions.length > 1 && (
          <div className="flex items-center gap-2 border-t pt-3">
            <span className="text-muted-foreground text-xs font-medium">Versions:</span>
            <div className="flex flex-wrap gap-1.5">
              {versions.map((ver, idx) => (
                <Button
                  key={ver.id}
                  onClick={() => {
                    setSelectedVersionId(ver.id);
                    setShowRejectForm(false);
                  }}
                  variant={ver.id === currentVersion.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                >
                  v{versions.length - idx} {ver.approved ? '✓' : '(draft)'}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Reject with Feedback Form */}
      {showRejectForm && !currentVersion.approved && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="font-heading text-sm font-semibold text-foreground">
              Provide Rejection Feedback
            </h3>
            <p className="text-muted-foreground text-xs">
              Explain what should be adjusted or removed. Your feedback is recorded in the version audit
              trail.
            </p>
          </div>
          <Textarea
            value={rejectFeedback}
            onChange={(e) => setRejectFeedback(e.target.value)}
            placeholder="e.g. Tone down the summary, emphasize Kubernetes and distributed systems more..."
            rows={3}
            className="text-sm bg-background"
          />
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setShowRejectForm(false);
                setRejectFeedback('');
              }}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReject}
              disabled={isRejecting || !rejectFeedback.trim()}
              size="sm"
              variant="destructive"
              className="gap-1.5"
            >
              {isRejecting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Submit Rejection
            </Button>
          </div>
        </Card>
      )}

      {/* Old → New Change Summary with "Why" */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-base font-semibold tracking-tight">
            Tailoring Changes & Rationale
          </h3>
          <span className="text-muted-foreground text-xs">
            {changes.length} section{changes.length === 1 ? '' : 's'} modified
          </span>
        </div>

        {/* High-level change summary */}
        <Card className="p-4 bg-muted/20 border-l-4 border-l-primary">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Executive Summary
          </p>
          <p className="text-sm leading-relaxed text-foreground">
            {currentVersion.changeSummary}
          </p>
        </Card>

        {/* Section changes breakdown */}
        {changes.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground text-sm">
            No line-by-line diff recorded for this draft version.
          </Card>
        ) : (
          <div className="space-y-4">
            {changes.map((detail, idx) => (
              <Card key={idx} className="p-5 space-y-4">
                {/* Section Header */}
                <div className="flex items-center justify-between gap-2 border-b pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs uppercase">
                      {detail.section}
                    </Badge>
                  </div>
                </div>

                {/* Strategic Rationale ("Why") */}
                {detail.rationale && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                    <Lightbulb className="size-4 shrink-0 text-primary mt-0.5" />
                    <div>
                      <span className="font-semibold text-foreground">Why this was changed: </span>
                      <span className="text-muted-foreground">{detail.rationale}</span>
                    </div>
                  </div>
                )}

                {/* Diff View: Old vs New */}
                <div className="grid gap-3 sm:grid-cols-2 text-xs">
                  {/* Previous / Old */}
                  <div className="space-y-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                    <div className="flex items-center gap-1.5 font-medium text-rose-700 dark:text-rose-400">
                      <MinusCircle className="size-3.5" />
                      <span>Previous (Base Resume)</span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap font-sans">
                      {detail.oldText || '— (None / Newly added)'}
                    </p>
                  </div>

                  {/* Tailored / New */}
                  <div className="space-y-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                      <PlusCircle className="size-3.5" />
                      <span>Tailored (Role-Optimized)</span>
                    </div>
                    <p className="text-foreground leading-relaxed whitespace-pre-wrap font-sans">
                      {detail.newText}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Full Resume Preview Toggle */}
      <Card className="p-4 sm:p-5 space-y-4">
        <button
          type="button"
          onClick={() => setShowFullResume(!showFullResume)}
          className="flex w-full items-center justify-between text-left font-heading text-sm font-semibold"
        >
          <span className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Full Tailored Resume Document Preview
          </span>
          {showFullResume ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {showFullResume && (
          <div className="border-t pt-4 space-y-6 text-sm">
            {/* Basics */}
            {currentVersion.structuredResume?.basics && (
              <div className="space-y-1 border-b pb-4">
                <h4 className="font-heading text-lg font-bold text-foreground">
                  {currentVersion.structuredResume.basics.name}
                </h4>
                {currentVersion.structuredResume.basics.label && (
                  <p className="text-sm font-medium text-primary">
                    {currentVersion.structuredResume.basics.label}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
                  {currentVersion.structuredResume.basics.email && (
                    <span>{currentVersion.structuredResume.basics.email}</span>
                  )}
                  {currentVersion.structuredResume.basics.phone && (
                    <span>· {currentVersion.structuredResume.basics.phone}</span>
                  )}
                  {currentVersion.structuredResume.basics.location?.city && (
                    <span>
                      · {currentVersion.structuredResume.basics.location.city}
                      {currentVersion.structuredResume.basics.location.region
                        ? `, ${currentVersion.structuredResume.basics.location.region}`
                        : ''}
                    </span>
                  )}
                </div>
                {currentVersion.structuredResume.basics.summary && (
                  <p className="text-xs leading-relaxed text-foreground mt-3 bg-muted/30 p-3 rounded-lg">
                    {currentVersion.structuredResume.basics.summary}
                  </p>
                )}
              </div>
            )}

            {/* Experience */}
            {currentVersion.structuredResume?.work &&
              currentVersion.structuredResume.work.length > 0 && (
                <div className="space-y-3 border-b pb-4">
                  <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Briefcase className="size-3.5" /> Professional Experience
                  </h5>
                  <div className="space-y-4">
                    {currentVersion.structuredResume.work.map((w, idx) => (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium text-foreground">
                            {w.position} · <span className="text-muted-foreground">{w.company}</span>
                          </p>
                          <span className="text-xs text-muted-foreground font-mono">
                            {w.startDate} — {w.endDate || (w.current ? 'Present' : '')}
                          </span>
                        </div>
                        {w.highlights && w.highlights.length > 0 && (
                          <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                            {w.highlights.map((h, hIdx) => (
                              <li key={hIdx} className="leading-relaxed">
                                {h}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Education */}
            {currentVersion.structuredResume?.education &&
              currentVersion.structuredResume.education.length > 0 && (
                <div className="space-y-3 border-b pb-4">
                  <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <GraduationCap className="size-3.5" /> Education
                  </h5>
                  <div className="space-y-2">
                    {currentVersion.structuredResume.education.map((edu, idx) => (
                      <div key={idx} className="flex justify-between items-baseline text-xs">
                        <p className="font-medium text-foreground">
                          {edu.studyType ? `${edu.studyType} in ` : ''}
                          {edu.area || 'General Studies'} ·{' '}
                          <span className="text-muted-foreground">{edu.institution}</span>
                        </p>
                        <span className="text-muted-foreground font-mono">
                          {edu.startDate ? `${edu.startDate} — ` : ''}
                          {edu.endDate || ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Skills */}
            {currentVersion.structuredResume?.skills &&
              currentVersion.structuredResume.skills.length > 0 && (
                <div className="space-y-3">
                  <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Wrench className="size-3.5" /> Skills & Competencies
                  </h5>
                  <div className="flex flex-wrap gap-2">
                    {currentVersion.structuredResume.skills.flatMap((s) => s.skills).map((skill, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </Card>
    </div>
  );
}
