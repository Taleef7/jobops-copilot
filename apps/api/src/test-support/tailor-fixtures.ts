import type { TailorAnswer } from '@/lib/tailor/answer';
import type { StructuredResume } from '@/types';

/**
 * A base résumé and posting for the tailoring tests (#351). The bullets carry the cases the
 * grounding check has to get right: numbers in several forms, identifiers that look like
 * numbers (p95, EC2, S3), "go-to-market" next to the Go language, and a tool (Python) that
 * only one role names.
 */
export const TAILOR_BASE: StructuredResume = {
  basics: {
    name: 'Jordan Lee',
    label: 'Backend Engineer',
    email: 'jordan@example.com',
    summary: 'Backend engineer who builds payment APIs in Go.',
  },
  work: [
    {
      company: 'Globex',
      position: 'Backend Engineer',
      startDate: '2022-01-01',
      current: true,
      highlights: [
        'Built the billing API in Go serving 2,000 merchants',
        'Reduced p95 latency by 40% with Redis caching',
        'Mentored two interns',
        'Partnered with sales on the go-to-market launch',
        'Presented the migration plan to leadership',
      ],
    },
    {
      company: 'Initech',
      position: 'Software Developer',
      startDate: '2019-06-01',
      endDate: '2021-12-01',
      highlights: [
        'Automated nightly reports with Python, saving 10 hours a week',
        'Migrated 3 services to EC2 and S3',
        'Cut build time from 12–15 min to 4 min',
        'Wrote C++ services in Golang',
      ],
    },
  ],
  education: [{ institution: 'University of London', studyType: 'BSc', area: 'Computer Science' }],
  skills: [
    { category: 'Languages', skills: ['Go', 'Python', 'SQL'] },
    { category: 'Infrastructure', skills: ['PostgreSQL', 'Docker'] },
  ],
};

/** The posting's company and the terms the fit read found in it. */
export const TAILOR_JOB = {
  company: 'Acme Pay Inc.',
  jobTerms: ['Kafka', 'Kubernetes', 'payments', 'Go'],
};

/** An answer with nothing in it; tests add what they need. */
export function emptyAnswer(overrides: Partial<TailorAnswer> = {}): TailorAnswer {
  return {
    change_summary: 'Led with the payments work.',
    edits: [],
    highlight_orders: [],
    skills_order: ['Go', 'Python', 'SQL', 'PostgreSQL', 'Docker'],
    added_skills: [],
    gaps: [],
    ...overrides,
  };
}

/** One edit, with old_text copied from the base line at `path` (as the model is told to). */
export function edit(path: string, newText: string, oldText?: string) {
  return {
    source_path: path,
    old_text: oldText ?? baseLine(path) ?? '',
    new_text: newText,
    rationale: 'The posting asks for this.',
  };
}

function baseLine(path: string): string | undefined {
  if (path === 'basics.summary') return TAILOR_BASE.basics.summary;
  const match = /^work\[(\d+)\]\.highlights\[(\d+)\]$/.exec(path);
  if (!match) return undefined;
  return TAILOR_BASE.work[Number(match[1])]?.highlights[Number(match[2])];
}
