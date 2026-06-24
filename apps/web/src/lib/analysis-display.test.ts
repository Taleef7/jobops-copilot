import { describe, expect, it } from 'vitest';
import { PRERANK_MODEL, isPrerankAnalysis, isHeuristicAnalysis } from './analysis-display';

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
