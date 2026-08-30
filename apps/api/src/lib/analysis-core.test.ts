import assert from 'node:assert/strict';
import test from 'node:test';
import { extractKeywords, groundingFromParsed, keywordCatalog, type ParsedJobOutput } from './analysis-core';

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

test('keywordCatalog has no duplicates and contains at least 50 entries', () => {
  assert.ok(keywordCatalog.length >= 50, `Expected keywordCatalog to have >= 50 items, but got ${keywordCatalog.length}`);
  const uniqueKeywords = new Set(keywordCatalog.map((k) => k.toLowerCase()));
  assert.equal(uniqueKeywords.size, keywordCatalog.length, 'keywordCatalog contains duplicate keywords (case-insensitive)');
});

test('extractKeywords matches short skill names on token boundaries and ignores substring false positives', () => {
  // "JavaScript" should match JavaScript, not Java
  const jsOnly = extractKeywords('We use JavaScript everyday.');
  assert.ok(jsOnly.includes('JavaScript'));
  assert.ok(!jsOnly.includes('Java'));

  // Standalone "Java" matches Java
  const javaOnly = extractKeywords('We use Java for backend services.');
  assert.ok(javaOnly.includes('Java'));

  // "Google Cloud", "MongoDB", "Django", "ongoing" should NOT match "Go"
  const noGo = extractKeywords('We use Google Cloud, MongoDB, and Django for ongoing operations.');
  assert.ok(!noGo.includes('Go'));
  assert.ok(noGo.includes('Google Cloud'));
  assert.ok(noGo.includes('MongoDB'));
  assert.ok(noGo.includes('Django'));

  // Standalone "Go" matches Go
  const goOnly = extractKeywords('We write Go and Python services.');
  assert.ok(goOnly.includes('Go'));
  assert.ok(goOnly.includes('Python'));

  // "trust" does NOT match "Rust"
  const noRust = extractKeywords('We trust the process and learn quickly.');
  assert.ok(!noRust.includes('Rust'));

  // Standalone "Rust" matches
  const rustOnly = extractKeywords('High-performance Rust systems.');
  assert.ok(rustOnly.includes('Rust'));

  // Symbols in skills like C#, C++, .NET
  const symbols = extractKeywords('Skilled in C#, C++, and .NET Core.');
  assert.ok(symbols.includes('C#'));
  assert.ok(symbols.includes('C++'));
  assert.ok(symbols.includes('.NET'));
});
