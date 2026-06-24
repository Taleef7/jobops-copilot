import { describe, expect, it } from 'vitest';
import { PRERANK_MODEL, isHeuristicAnalysis, isPrerankAnalysis } from './analysis-display';

describe('isHeuristicAnalysis (QA·B heuristic banner)', () => {
  it('flags only the unambiguous fit-scorer fallback marker', () => {
    expect(isHeuristicAnalysis('mock-fit-scorer-v1')).toBe(true);
  });

  it('does NOT flag mock-analysis-v1 (reused for real parses + new-job placeholder)', () => {
    expect(isHeuristicAnalysis('mock-analysis-v1')).toBe(false);
  });

  it('does not flag a real model id or missing value', () => {
    expect(isHeuristicAnalysis('anthropic:claude-sonnet-4-6')).toBe(false);
    expect(isHeuristicAnalysis(null)).toBe(false);
    expect(isHeuristicAnalysis(undefined)).toBe(false);
  });
});

describe('isPrerankAnalysis', () => {
  it('is true only for the local-prerank sentinel', () => {
    expect(PRERANK_MODEL).toBe('local-prerank');
    expect(isPrerankAnalysis('local-prerank')).toBe(true);
    expect(isPrerankAnalysis('mock-analysis-v1')).toBe(false);
    expect(isPrerankAnalysis(null)).toBe(false);
    expect(isPrerankAnalysis(undefined)).toBe(false);
  });

  it('does not classify the pre-rank sentinel as a heuristic fit', () => {
    expect(isHeuristicAnalysis('local-prerank')).toBe(false);
  });
});
