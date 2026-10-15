import { describe, expect, it } from 'vitest';
import { getReportSnapshot } from './report-snapshot';
import type { Job, JobAnalysis, JobStatus, OutreachDraft } from '@/types/job';

function analysis(missingSkills: string[] = []): JobAnalysis {
  return {
    requiredSkills: [],
    preferredSkills: [],
    matchedSkills: [],
    missingSkills,
    atsKeywords: [],
    fitSummary: '',
    recommendedResumeAngle: '',
    applyRecommendation: '',
    confidenceScore: 0,
    modelUsed: 'mock-analysis-v1',
  };
}

function job(opts: {
  status?: JobStatus;
  missingSkills?: string[];
  outreach?: OutreachDraft[];
} = {}): Job {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    source: 'manual',
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    discoveredAt: '2026-06-01T00:00:00.000Z',
    descriptionText: '',
    status: opts.status ?? 'discovered',
    priority: 'medium',
    fitScore: null,
    nextAction: '',
    analysis: analysis(opts.missingSkills ?? []),
    outreach: opts.outreach ?? [],
  };
}

function outreach(status: OutreachDraft['status']): OutreachDraft {
  return {
    id: `o-${Math.random().toString(36).slice(2)}`,
    contactName: 'Pat',
    contactRole: 'Recruiter',
    contactSource: 'manual',
    messageType: 'recruiter_email',
    draftText: 'hello',
    status,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

describe('getReportSnapshot', () => {
  it('returns all-zero metrics and no skills/recommendations for an empty pipeline', () => {
    const snap = getReportSnapshot([]);

    expect(snap.discovered).toBe(0);
    expect(snap.applied).toBe(0);
    expect(snap.outreachSent).toBe(0);
    expect(snap.interviews).toBe(0);
    expect(snap.commonMissingSkills).toEqual([]);
    expect(snap.recommendations).toEqual([]);
  });

  it('aggregates real metrics from the live pipeline', () => {
    const jobs = [
      job({ status: 'discovered' }),
      job({ status: 'applied' }),
      job({ status: 'interview' }),
      job({ status: 'shortlisted', outreach: [outreach('sent')] }),
      job({ status: 'discovered', outreach: [outreach('drafted')] }),
    ];

    const snap = getReportSnapshot(jobs);

    expect(snap.discovered).toBe(5); // total jobs tracked
    expect(snap.applied).toBe(1);
    expect(snap.interviews).toBe(1);
    expect(snap.outreachSent).toBe(1); // only the 'sent' outreach counts
  });

  it('ranks recurring missing skills by frequency', () => {
    const jobs = [
      job({ missingSkills: ['Kubernetes', 'Go'] }),
      job({ missingSkills: ['Kubernetes'] }),
      job({ missingSkills: ['Kubernetes', 'Go'] }),
      job({ missingSkills: ['Rust'] }),
    ];

    const snap = getReportSnapshot(jobs);

    // Kubernetes (3) > Go (2) > Rust (1)
    expect(snap.commonMissingSkills.slice(0, 3)).toEqual(['Kubernetes', 'Go', 'Rust']);
  });

  it('derives recommendations from real data, not hardcoded marketing copy', () => {
    const jobs = [
      job({ status: 'shortlisted', missingSkills: ['Azure Functions', 'Azure Functions'] }),
      job({ status: 'discovered', missingSkills: ['Azure Functions'], outreach: [outreach('drafted')] }),
    ];

    const snap = getReportSnapshot(jobs);

    expect(snap.recommendations.length).toBe(3);
    // grounded in the real top gap
    expect(snap.recommendations.some((r) => r.includes('Azure Functions'))).toBe(true);
    // never the old fabricated bullets
    expect(
      snap.recommendations.includes(
        'Tailor the headline toward operations automation and workflow systems.',
      ),
    ).toBe(false);
  });
});
