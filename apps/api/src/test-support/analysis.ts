import type { JobAnalysis } from '@/types';

/**
 * A complete analysis for tests that save one. Jobs have no analysis until a real score
 * (#349), so tests can't borrow the one a job used to get at creation.
 */
export function sampleAnalysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    requiredSkills: ['Go', 'Postgres'],
    preferredSkills: ['Kafka'],
    matchedSkills: ['Go'],
    missingSkills: ['Postgres'],
    atsKeywords: ['Go', 'Postgres', 'Kafka'],
    fitSummary: 'Strong on Go.',
    recommendedResumeAngle: 'Lead with the Go services.',
    applyRecommendation: 'Review manually before deciding whether to apply.',
    confidenceScore: 70,
    modelUsed: 'openai:gpt-5.4-nano',
    ...overrides,
  };
}
