import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analysisFromFit,
  extractKeywords,
  groundingFromParsed,
  keywordCatalog,
  normalizeAnalysis,
  skillNames,
  toConfidence,
  validateFitScoreOutput,
  type FitScoreOutput,
  type ParsedJobOutput,
} from './analysis-core';
import type { JobAnalysis } from '@/types';

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

// --- #354: fit output -------------------------------------------------------

function fit(overrides: Partial<FitScoreOutput> = {}): FitScoreOutput {
  return {
    fit_score: 70,
    matched_skills: [{ skill: 'Go', evidence: 'Built the billing API in Go.' }],
    missing_skills: [{ skill: 'Kafka', posting_quote: 'Experience with Kafka' }],
    ats_keywords: ['Go', 'Kafka'],
    fit_summary: 'You build Go services.',
    recommended_resume_angle: 'Lead with the Go services.',
    apply_recommendation: 'review',
    confidence_score: 70,
    model_used: 'openai:gpt-6-luna',
    ...overrides,
  };
}

const context = { requiredSkills: ['Go', 'Kafka'], preferredSkills: [] };

/** An old default the stores wrote before #354, kept out of literal `: 50` greps. */
const OLD_DEFAULT = 50;

test('a 0–1 confidence is read as a percentage, 1 stays 1, and null stays null (#354)', () => {
  assert.equal(toConfidence(0.65), 65);
  assert.equal(toConfidence(65), 65);
  assert.equal(toConfidence(1), 1);
  assert.equal(toConfidence(0), 0);
  assert.equal(toConfidence(null), null);
  assert.equal(toConfidence(undefined), null);
  assert.equal(analysisFromFit(fit({ confidence_score: 0.65 }), context).confidenceScore, 65);
});

test('a fit read without a confidence saves none, not a default (#354)', () => {
  assert.equal(analysisFromFit(fit({ confidence_score: null }), context).confidenceScore, null);
  assert.ok(validateFitScoreOutput(fit({ confidence_score: null })));
});

test('sub-signals the model left out stay unknown (#354)', () => {
  assert.deepEqual(analysisFromFit(fit({ sub_signals: undefined }), context).subSignals, {
    skillsMatch: null,
    titleSeniority: null,
    salaryFit: null,
    sponsorshipLikelihood: null,
  });
  assert.deepEqual(analysisFromFit(fit({ sub_signals: { skills_match: 80 } }), context).subSignals, {
    skillsMatch: 80,
    titleSeniority: null,
    salaryFit: null,
    sponsorshipLikelihood: null,
  });
});

test("an agent image from before #354 sends four 50s for a read without sub-signals: they're unknown (#354)", () => {
  const sub_signals = {
    skills_match: OLD_DEFAULT,
    title_seniority: OLD_DEFAULT,
    salary_fit: OLD_DEFAULT,
    sponsorship_likelihood: OLD_DEFAULT,
  };
  assert.deepEqual(analysisFromFit(fit({ sub_signals }), context).subSignals, {
    skillsMatch: null,
    titleSeniority: null,
    salaryFit: null,
    sponsorshipLikelihood: null,
  });
});

test("the old agent's 50s for the fields the model left out are unknown, and so is its default confidence (#354)", () => {
  // Salary fit and sponsorship both exactly 50: the old agent filled what the model left out.
  const defaulted = { salary_fit: OLD_DEFAULT, sponsorship_likelihood: OLD_DEFAULT };
  const titleDefault = analysisFromFit(
    fit({ sub_signals: { ...defaulted, skills_match: 80, title_seniority: OLD_DEFAULT }, confidence_score: OLD_DEFAULT }),
    context,
  );
  assert.deepEqual(titleDefault.subSignals, {
    skillsMatch: 80,
    titleSeniority: null,
    salaryFit: null,
    sponsorshipLikelihood: null,
  });
  assert.equal(titleDefault.confidenceScore, null);

  const skillsDefault = analysisFromFit(
    fit({ sub_signals: { ...defaulted, skills_match: OLD_DEFAULT, title_seniority: 70 } }),
    context,
  );
  assert.equal(skillsDefault.subSignals?.skillsMatch, null);
  assert.equal(skillsDefault.subSignals?.titleSeniority, 70);

  // A salary or sponsorship the model did answer means its 50s are its own.
  const answered = analysisFromFit(
    fit({
      sub_signals: { skills_match: 80, title_seniority: OLD_DEFAULT, salary_fit: 60, sponsorship_likelihood: OLD_DEFAULT },
      confidence_score: OLD_DEFAULT,
    }),
    context,
  );
  assert.equal(answered.subSignals?.titleSeniority, OLD_DEFAULT);
  assert.equal(answered.confidenceScore, OLD_DEFAULT);
});

test('salary fit and sponsorship are unknown whatever the model said, until preferences exist (#354)', () => {
  const analysis = analysisFromFit(
    fit({ sub_signals: { skills_match: 80, title_seniority: 70, salary_fit: 30, sponsorship_likelihood: 60 } }),
    context,
  );
  assert.equal(analysis.subSignals?.salaryFit, null);
  assert.equal(analysis.subSignals?.sponsorshipLikelihood, null);
  assert.equal(analysis.subSignals?.titleSeniority, 70);
});

test('a missing skill that a matched skill implies is dropped (#354)', () => {
  const analysis = analysisFromFit(
    fit({
      matched_skills: [
        { skill: 'PostgreSQL', evidence: 'Ran Postgres in production.' },
        { skill: 'TypeScript', evidence: 'Wrote the API in TypeScript.' },
        { skill: 'Next.js', evidence: 'Built the web app in Next.js.' },
      ],
      missing_skills: [
        { skill: 'SQL', posting_quote: 'Strong SQL' },
        { skill: 'JavaScript', posting_quote: 'JavaScript' },
        { skill: 'React', posting_quote: 'React' },
        { skill: 'Kafka', posting_quote: 'Kafka' },
      ],
    }),
    context,
  );
  assert.deepEqual(analysis.missingSkills, ['Kafka']);
  assert.deepEqual(analysis.missingSkillDetails, [{ skill: 'Kafka', postingQuote: 'Kafka' }]);
});

test('implied skills match however the labels are written (#354)', () => {
  const cases: Array<[string, string]> = [
    ['MySQL', 'SQL'],
    ['SQL Server', 'SQL'],
    ['Microsoft SQL Server', 'SQL'],
    ['MS SQL Server', 'SQL'],
    ['Postgres (Aurora)', 'SQL'],
    ['PostgreSQL', 'SQL databases'],
    ['Next.js', 'React.js'],
    ['TypeScript', 'JavaScript (ES6+)'],
  ];
  for (const [matched, missing] of cases) {
    const analysis = analysisFromFit(
      fit({ matched_skills: [{ skill: matched, evidence: '' }], missing_skills: [{ skill: missing, posting_quote: '' }] }),
      context,
    );
    assert.deepEqual(analysis.missingSkills, [], `${matched} implies ${missing}`);
  }
});

test('a matched skill drops only what it implies (#354)', () => {
  const analysis = analysisFromFit(
    fit({
      matched_skills: [{ skill: 'PostgreSQL', evidence: '' }],
      missing_skills: [
        { skill: 'SQL Server', posting_quote: '' },
        { skill: 'MySQL', posting_quote: '' },
      ],
    }),
    context,
  );
  assert.deepEqual(analysis.missingSkills, ['SQL Server', 'MySQL']);
});

test('"Next" implies React only as Next.js, not inside another skill (#354)', () => {
  const analysis = analysisFromFit(
    fit({
      matched_skills: [{ skill: 'Next-gen sequencing', evidence: '' }],
      missing_skills: [{ skill: 'React', posting_quote: '' }],
    }),
    context,
  );
  assert.deepEqual(analysis.missingSkills, ['React']);
});

test('skills are short labels any web reads as strings, with the details apart, at most 8 each (#354)', () => {
  const analysis = analysisFromFit(
    fit({
      matched_skills: [
        { skill: 'Go', evidence: 'Built the billing API in Go.' },
        ...Array.from({ length: 10 }, (_, index) => ({ skill: `Skill ${index}`, evidence: '' })),
      ],
      missing_skills: [{ skill: 'Kafka', posting_quote: 'Experience with Kafka' }],
    }),
    context,
  );
  // The web before #354 renders matchedSkills and missingSkills as strings.
  assert.ok([...analysis.matchedSkills, ...analysis.missingSkills].every((skill) => typeof skill === 'string'));
  assert.equal(analysis.matchedSkills[0], 'Go');
  assert.equal(analysis.matchedSkills.length, 8);
  assert.deepEqual(analysis.matchedSkillDetails?.[0], { skill: 'Go', evidence: 'Built the billing API in Go.' });
  assert.equal(analysis.matchedSkillDetails?.length, 8);
  assert.deepEqual(analysis.missingSkills, ['Kafka']);
  assert.deepEqual(analysis.missingSkillDetails, [{ skill: 'Kafka', postingQuote: 'Experience with Kafka' }]);
});

test('no saved skill label is longer than four words (#354)', () => {
  const sentence =
    "Data validation / QA reviews (quality & documentation): described 'validating every output against 455 of 455 official test cases,' plus reviews";
  const analysis = analysisFromFit(
    fit({
      matched_skills: [
        { skill: sentence, evidence: '' },
        { skill: 'Data validation: checked every output', evidence: 'Ran the QA reviews.' },
      ],
      missing_skills: [{ skill: 'Hands-on experience running large Kafka clusters', posting_quote: '' }],
    }),
    context,
  );
  for (const { skill } of [...(analysis.matchedSkillDetails ?? []), ...(analysis.missingSkillDetails ?? [])]) {
    assert.ok(skill.split(/\s+/).length <= 4, skill);
  }
  // "Other" is not a skill: it stays out of the labels and lives only in the details.
  assert.deepEqual(analysis.matchedSkills, ['Data validation']);
  assert.deepEqual(analysis.matchedSkillDetails, [
    { skill: 'Other', evidence: sentence },
    { skill: 'Data validation', evidence: 'checked every output Ran the QA reviews.' },
  ]);
  assert.deepEqual(analysis.missingSkills, []);
  assert.equal(analysis.missingSkillDetails?.[0]?.skill, 'Other');
});

test('an agent image from before #354 still scores: plain-string skills are read too', () => {
  const analysis = analysisFromFit(
    fit({ matched_skills: ['Go', 'PostgreSQL'], missing_skills: ['SQL', 'Kafka: the posting asks for it'] }),
    context,
  );
  assert.deepEqual(analysis.matchedSkills, ['Go', 'PostgreSQL']);
  assert.deepEqual(analysis.missingSkills, ['Kafka']);
  assert.deepEqual(analysis.missingSkillDetails, [{ skill: 'Kafka', postingQuote: 'the posting asks for it' }]);
});

test('a stored analysis from before #354 reads with short labels and details (#354)', () => {
  const stored: JobAnalysis = {
    requiredSkills: ['SQL'],
    preferredSkills: [],
    matchedSkills: ['Python: built the ETL jobs in Python', 'Go'],
    missingSkills: ['Hands-on experience running large Kafka clusters in production'],
    atsKeywords: [],
    fitSummary: 'x',
    recommendedResumeAngle: 'y',
    applyRecommendation: 'z',
    confidenceScore: 0.65,
    modelUsed: 'openai:gpt-5.4-nano',
    subSignals: { skillsMatch: 55, titleSeniority: 45, salaryFit: 60, sponsorshipLikelihood: 30 },
  };

  const analysis = normalizeAnalysis(stored);

  assert.deepEqual(analysis.matchedSkills, ['Python', 'Go']);
  assert.deepEqual(analysis.matchedSkillDetails, [
    { skill: 'Python', evidence: 'built the ETL jobs in Python' },
    { skill: 'Go', evidence: '' },
  ]);
  assert.deepEqual(analysis.missingSkills, []);
  assert.deepEqual(analysis.missingSkillDetails, [
    { skill: 'Other', postingQuote: 'Hands-on experience running large Kafka clusters in production' },
  ]);
  assert.equal(analysis.confidenceScore, 65);
  assert.deepEqual(analysis.subSignals, {
    skillsMatch: 55,
    titleSeniority: 45,
    salaryFit: null,
    sponsorshipLikelihood: null,
  });
});

test('saved details are used only while they match the labels (#354)', () => {
  const base: JobAnalysis = {
    requiredSkills: [],
    preferredSkills: [],
    matchedSkills: ['Go'],
    missingSkills: [],
    matchedSkillDetails: [{ skill: 'Go', evidence: 'Built the billing API in Go.' }],
    atsKeywords: [],
    fitSummary: 'x',
    recommendedResumeAngle: 'y',
    applyRecommendation: 'z',
    confidenceScore: 70,
    modelUsed: 'openai:gpt-6-luna',
  };
  assert.deepEqual(normalizeAnalysis(base).matchedSkillDetails, base.matchedSkillDetails);
  // An API from before #354 rewrote the labels and left the old details behind.
  assert.deepEqual(normalizeAnalysis({ ...base, matchedSkills: ['Rust'] }).matchedSkillDetails, [
    { skill: 'Rust', evidence: '' },
  ]);
  // Same name, but the label carries its own, newer reason: that one is current.
  assert.deepEqual(normalizeAnalysis({ ...base, matchedSkills: ['Go: wrote the payments service'] }).matchedSkillDetails, [
    { skill: 'Go', evidence: 'wrote the payments service' },
  ]);
});

test('labels saved as objects, by an API from before #354 with a newer agent, still read (#354)', () => {
  const analysis = normalizeAnalysis({
    requiredSkills: [],
    preferredSkills: [],
    matchedSkills: [{ skill: 'Go', evidence: 'Built the billing API in Go.' }],
    missingSkills: [{ skill: 'Kafka', posting_quote: 'Experience with Kafka' }],
    matchedSkillDetails: [{ skill: 'Go', evidence: 'An older reading.' }],
    atsKeywords: [],
    fitSummary: 'x',
    recommendedResumeAngle: 'y',
    applyRecommendation: 'z',
    confidenceScore: 70,
    modelUsed: 'openai:gpt-6-luna',
  });
  assert.deepEqual(analysis.matchedSkills, ['Go']);
  assert.deepEqual(analysis.matchedSkillDetails, [{ skill: 'Go', evidence: 'Built the billing API in Go.' }]);
  assert.deepEqual(analysis.missingSkills, ['Kafka']);
  assert.deepEqual(analysis.missingSkillDetails, [{ skill: 'Kafka', postingQuote: 'Experience with Kafka' }]);
});

test('details saved with "Other" items line up with labels that leave "Other" out (#354)', () => {
  const analysis = normalizeAnalysis({
    requiredSkills: [],
    preferredSkills: [],
    matchedSkills: ['Go'],
    missingSkills: [],
    matchedSkillDetails: [
      { skill: 'Other', evidence: 'A sentence the model wrote as a skill.' },
      { skill: 'Go', evidence: 'Built the billing API in Go.' },
    ],
    atsKeywords: [],
    fitSummary: 'x',
    recommendedResumeAngle: 'y',
    applyRecommendation: 'z',
    confidenceScore: 70,
    modelUsed: 'openai:gpt-6-luna',
  });
  assert.deepEqual(analysis.matchedSkills, ['Go']);
  assert.equal(analysis.matchedSkillDetails?.length, 2);
});

test("an old row's defaulted title and confidence read as unknown (#354)", () => {
  const analysis = normalizeAnalysis({
    requiredSkills: [],
    preferredSkills: [],
    matchedSkills: [],
    missingSkills: [],
    atsKeywords: [],
    fitSummary: 'x',
    recommendedResumeAngle: 'y',
    applyRecommendation: 'z',
    confidenceScore: OLD_DEFAULT,
    modelUsed: 'openai:gpt-5.4-nano',
    subSignals: { skillsMatch: 80, titleSeniority: OLD_DEFAULT, salaryFit: OLD_DEFAULT, sponsorshipLikelihood: OLD_DEFAULT },
  });
  assert.deepEqual(analysis.subSignals, {
    skillsMatch: 80,
    titleSeniority: null,
    salaryFit: null,
    sponsorshipLikelihood: null,
  });
  assert.equal(analysis.confidenceScore, null);
});

test("an old row's default sub-signals read as unknown, and a pre-rank's skills signal is its score (#354)", () => {
  const unknown = { skillsMatch: null, titleSeniority: null, salaryFit: null, sponsorshipLikelihood: null };
  const defaults = {
    skillsMatch: OLD_DEFAULT,
    titleSeniority: OLD_DEFAULT,
    salaryFit: OLD_DEFAULT,
    sponsorshipLikelihood: OLD_DEFAULT,
  };
  const base = {
    requiredSkills: [],
    preferredSkills: [],
    matchedSkills: [],
    missingSkills: [],
    atsKeywords: [],
    fitSummary: 'x',
    recommendedResumeAngle: 'y',
    applyRecommendation: 'z',
    confidenceScore: null,
  };

  // Four 50s were the object an answer without sub-signals was given.
  assert.deepEqual(normalizeAnalysis({ ...base, modelUsed: 'openai:gpt-5.4-nano', subSignals: defaults }).subSignals, unknown);
  // The keyword pre-rank only measures skills, and that signal is its score: a real 50 stays.
  const prerank = { ...base, modelUsed: 'local-prerank', subSignals: defaults };
  assert.deepEqual(normalizeAnalysis(prerank, OLD_DEFAULT).subSignals, { ...unknown, skillsMatch: OLD_DEFAULT });
  assert.deepEqual(normalizeAnalysis(prerank, null).subSignals, unknown);
  assert.deepEqual(normalizeAnalysis({ ...prerank, subSignals: { ...defaults, skillsMatch: 67 } }, 67).subSignals, {
    ...unknown,
    skillsMatch: 67,
  });
});

test('skillNames gives the labels, strings or objects, without "Other" (#354)', () => {
  assert.deepEqual(skillNames(['Go', 'Other', { skill: 'Kafka' }]), ['Go', 'Kafka']);
});
