import assert from 'node:assert/strict';
import test from 'node:test';
import { groundingFromParsed, type ParsedJobOutput } from './analysis-core';

const fallback = {
  requiredSkills: ['Python'],
  preferredSkills: ['SQL'],
  atsKeywords: ['Python', 'SQL'],
};

function parsed(overrides: Partial<ParsedJobOutput> = {}): ParsedJobOutput {
  return {
    company: null,
    title: null,
    required_skills: ['RAG', 'LangChain'],
    preferred_skills: ['Kubernetes'],
    responsibilities: [],
    seniority: 'mid',
    cloud_tools: [],
    automation_tools: [],
    summary: 'summary',
    ...overrides,
  };
}

test('groundingFromParsed prefers freshly-parsed skills over the stored fallback', () => {
  const grounding = groundingFromParsed(parsed(), fallback);

  // Uses the fresh parse, not the (possibly incomplete) stored analysis.
  assert.deepEqual(grounding.requiredSkills, ['RAG', 'LangChain']);
  assert.deepEqual(grounding.preferredSkills, ['Kubernetes']);
  assert.ok(grounding.atsKeywords.includes('RAG'));
});

test('groundingFromParsed falls back to the stored analysis when the parse is invalid', () => {
  const grounding = groundingFromParsed(null, fallback);

  assert.deepEqual(grounding.requiredSkills, ['Python']);
  assert.deepEqual(grounding.preferredSkills, ['SQL']);
  assert.deepEqual(grounding.atsKeywords, ['Python', 'SQL']);
});
