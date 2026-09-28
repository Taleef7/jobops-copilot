import { describe, expect, it } from 'vitest';
import {
  PRERANK_MODEL,
  isHeuristicAnalysis,
  isPrerankAnalysis,
  isSkillLabelTruncated,
  skillLabel,
} from './analysis-display';

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

describe('skillLabel', () => {
  // The strings below are verbatim `missing_skills` entries from the live
  // scorer (gpt-5.4-nano): reasoning, not skill tokens. Rendering them raw
  // turned the dashboard and weekly report into walls of model commentary.

  it('prefers a leading quoted phrase over the surrounding justification', () => {
    expect(
      skillLabel(
        '"Intelligent automation platforms" (automation is implied via agent workflows, but the job\'s wording is not explicitly evidenced)',
      ),
    ).toBe('Intelligent automation platforms');
  });

  it('handles curly quotes and trailing commentary', () => {
    expect(
      skillLabel('“Large Language Models” phrasing is present, but no specific details follow'),
    ).toBe('Large Language Models');
  });

  it('drops a trailing parenthetical aside when there is no quoted phrase', () => {
    expect(
      skillLabel('LangGraph tool integrations (explicit tool experience not mentioned)'),
    ).toBe('LangGraph tool integrations');
  });

  it('elides an over-long label', () => {
    const label = skillLabel(
      'Explicit experience with deployment of LLM/GAI solutions to meet business stakeholder requirements',
    );
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary skill token untouched', () => {
    expect(skillLabel('Kubernetes')).toBe('Kubernetes');
    expect(skillLabel('  TypeScript  ')).toBe('TypeScript');
    expect(isSkillLabelTruncated('Kubernetes')).toBe(false);
  });

  it('reports truncation so callers can expose the original', () => {
    expect(isSkillLabelTruncated('"Intelligent automation platforms" (implied)')).toBe(true);
  });
});
