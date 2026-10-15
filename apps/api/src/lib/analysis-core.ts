import type { JobAnalysis, JobAnalysisSubSignals, MatchedSkill, MissingSkill } from '@/types';

export type ParsedJobSeniority = 'junior' | 'mid' | 'senior' | 'lead' | 'unknown';

/** What the job parser can say about where the work is done (#355). */
export const PARSED_WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite'] as const;
export type ParsedWorkplaceType = (typeof PARSED_WORKPLACE_TYPES)[number];

const WORKPLACE_WORDS: Record<string, ParsedWorkplaceType> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'onsite',
  'on-site': 'onsite',
  'on site': 'onsite',
  'in-office': 'onsite',
  'in office': 'onsite',
};

/**
 * The parser's workplace in the app's words. Null stays null ("not stated"); a word the app
 * doesn't know is undefined (unknown). A leading "remote" ("remote-first", "Remote (US)") is
 * remote unless it also names an office or hybrid.
 */
export function normalizeWorkplace(value: unknown): ParsedWorkplaceType | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase();
  const known = WORKPLACE_WORDS[word];
  if (known) return known;
  if (/^remote\b/.test(word) && !/hybrid|office|on-?\s?site/.test(word)) return 'remote';
  return undefined;
}

export interface ParsedJobOutput {
  company: string | null;
  title: string | null;
  /** Where the job is based, as the posting says. An agent from before #355 leaves it out. */
  location?: string | null;
  /** Remote, hybrid or on-site, when the posting says. An agent from before #355 leaves it out. */
  workplace_type?: ParsedWorkplaceType | null;
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  seniority: ParsedJobSeniority;
  cloud_tools: string[];
  automation_tools: string[];
  summary: string;
}

export interface FitScoreOutput {
  fit_score: number;
  sub_signals?: {
    skills_match?: number | null;
    title_seniority?: number | null;
    salary_fit?: number | null;
    sponsorship_likelihood?: number | null;
  };
  // Objects since #354; an agent image from before it answers with plain strings.
  matched_skills: Array<{ skill: string; evidence?: string } | string>;
  missing_skills: Array<{ skill: string; posting_quote?: string } | string>;
  ats_keywords: string[];
  fit_summary: string;
  recommended_resume_angle: string;
  apply_recommendation: 'apply' | 'review' | 'pass';
  confidence_score: number | null;
  model_used: string;
}

export const keywordCatalog = [
  'TypeScript',
  'JavaScript',
  'React',
  'Next.js',
  'Azure Functions',
  'Azure Blob Storage',
  'PostgreSQL',
  'SQL',
  'n8n',
  'Zapier',
  'Make.com',
  'OpenAI',
  'Azure OpenAI',
  'LLM',
  'Express',
  'Python',
  'Node.js',
  'Workflow automation',
  'CRM',
  'Analytics',
  'Java',
  'C#',
  '.NET',
  'Go',
  'Rust',
  'C++',
  'Ruby',
  'PHP',
  'Kotlin',
  'Swift',
  'Kubernetes',
  'Docker',
  'Terraform',
  'AWS',
  'GCP',
  'Google Cloud',
  'Azure',
  'Linux',
  'Git',
  'CI/CD',
  'GraphQL',
  'REST API',
  'gRPC',
  'Redis',
  'Kafka',
  'RabbitMQ',
  'MongoDB',
  'MySQL',
  'Elasticsearch',
  'Snowflake',
  'dbt',
  'Airflow',
  'Spark',
  'ETL',
  'Machine Learning',
  'Deep Learning',
  'PyTorch',
  'TensorFlow',
  'LangChain',
  'RAG',
  'Prompt Engineering',
  'FastAPI',
  'Django',
  'Flask',
  'Spring',
  'Vue',
  'Angular',
  'Tailwind',
  'Playwright',
  'Jest',
  'Grafana',
  'Prometheus',
  'Datadog',
  'Agile',
  'Scrum',
] as const;

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const keywordRegexes = keywordCatalog.map((keyword) => {
  const escaped = escapeRegex(keyword);
  // Match keyword bounded by non-alphanumeric characters or string ends,
  // treating # and + as word-like characters so C# and C++ aren't truncated.
  const regex = new RegExp(`(^|[^a-zA-Z0-9#+])(${escaped})($|[^a-zA-Z0-9#+])`, 'i');
  return { keyword, regex };
});

export function extractKeywords(text: string): string[] {
  return keywordRegexes
    .filter(({ regex }) => regex.test(text))
    .map(({ keyword }) => keyword);
}

function inferCompany(description: string) {
  const match = description.match(/for\s+([A-Z][A-Za-z0-9&.,\s-]{2,40})/);
  return match?.[1]?.trim() ?? null;
}

function inferTitle(description: string) {
  const titleCandidates = [
    'AI Automation Engineer',
    'Automation Engineer',
    'Workflow Operations Analyst',
    'Solutions Consultant',
    'Technical Program Manager',
    'Recruiting Operations Specialist',
  ];

  return (
    titleCandidates.find((candidate) => description.toLowerCase().includes(candidate.toLowerCase())) ?? null
  );
}

function inferSeniority(description: string): ParsedJobSeniority {
  if (/principal|staff/i.test(description)) {
    return 'lead';
  }

  if (/senior/i.test(description)) {
    return 'senior';
  }

  if (/manager|lead/i.test(description)) {
    return 'lead';
  }

  if (/intern|junior|entry/i.test(description)) {
    return 'junior';
  }

  return 'mid';
}

function buildResponsibilities(keywords: string[]) {
  return keywords.slice(0, 4).map((keyword) => `Contribute to ${keyword.toLowerCase()} initiatives.`);
}

/**
 * Resolve the structured-skill grounding for fit scoring. Prefers a fresh parse
 * (the LLM job parser is richer than the keyword extractor) and only falls back
 * to the job's stored analysis when the parse is missing/invalid. This is what
 * folds the old standalone "Parse job" step into "Score fit" so a job's parsed
 * skills can't stay empty/incomplete behind a successful score.
 */
export function groundingFromParsed(
  parsed: ParsedJobOutput | null,
  fallback: Pick<JobAnalysis, 'requiredSkills' | 'preferredSkills' | 'atsKeywords'> | null,
): { requiredSkills: string[]; preferredSkills: string[]; atsKeywords: string[] } {
  if (!parsed || !validateParsedJobOutput(parsed)) {
    return {
      requiredSkills: fallback?.requiredSkills ?? [],
      preferredSkills: fallback?.preferredSkills ?? [],
      atsKeywords: fallback?.atsKeywords ?? [],
    };
  }

  return {
    requiredSkills: parsed.required_skills,
    preferredSkills: parsed.preferred_skills,
    atsKeywords: unique([...parsed.required_skills, ...parsed.preferred_skills]).slice(0, 6),
  };
}

/** Matched and missing skills kept from one fit read, each (#354). */
export const MAX_SKILLS = 8;
/** A skill label is a name, not a sentence (#354). */
export const MAX_SKILL_WORDS = 4;
/** The label of an item that was a sentence, not a skill; the sentence is its evidence. */
export const OTHER_SKILL = 'Other';

/** The keyword pre-rank's `modelUsed` (`PRERANK_MODEL` in local-fit). It only measures skills. */
const PRERANK_MODEL = 'local-prerank';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * A confidence on the 0–100 scale, or null (#354). A fraction is on a 0–1 scale (the file
 * store used to save 0.65); 0 and 1 are already percentages.
 */
export function toConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return percent(value > 0 && value < 1 ? value * 100 : value);
}

function toSignal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? percent(value) : null;
}

/** What an agent from before #354 filled in for a sub-signal or confidence the model left out. */
const OLD_AGENT_DEFAULT = 50;

function signalFields(raw: unknown) {
  const signals = isRecord(raw) ? raw : {};
  return {
    skillsMatch: signals.skillsMatch ?? signals.skills_match,
    titleSeniority: signals.titleSeniority ?? signals.title_seniority,
    salaryFit: signals.salaryFit ?? signals.salary_fit,
    sponsorship: signals.sponsorshipLikelihood ?? signals.sponsorship_likelihood,
  };
}

/**
 * Salary fit and sponsorship both exactly 50: what the agent before #354 gave a read whose model
 * left them out, which its answers and older rows still hold. A skills or title 50 beside them,
 * and a confidence of 50, are that default too, not a reading.
 */
function hasOldAgentDefaults(raw: unknown): boolean {
  const { salaryFit, sponsorship } = signalFields(raw);
  return salaryFit === OLD_AGENT_DEFAULT && sponsorship === OLD_AGENT_DEFAULT;
}

/**
 * Sub-signals on 0–100, or null when unknown (#354). Salary fit and sponsorship are always
 * unknown for now: they compare the posting with the user's salary floor and visa needs, which
 * nobody can enter yet (C4, then E1), so a number there is the model's guess.
 */
export function toSubSignals(raw: unknown): JobAnalysisSubSignals {
  const { skillsMatch, titleSeniority } = signalFields(raw);
  const defaulted = hasOldAgentDefaults(raw);
  const reading = (value: unknown) => (defaulted && value === OLD_AGENT_DEFAULT ? null : toSignal(value));
  return {
    skillsMatch: reading(skillsMatch),
    titleSeniority: reading(titleSeniority),
    salaryFit: null,
    sponsorshipLikelihood: null,
  };
}

/** A confidence on 0–100, or null when there is none or it is the old agent's default. */
function readConfidence(value: unknown, subSignals: unknown): number | null {
  return hasOldAgentDefaults(subSignals) && value === OLD_AGENT_DEFAULT ? null : toConfidence(value);
}

const loggedLongLabels = new Set<string>();

/**
 * A skill as a short label and the text that explains it. The model used to write its reasoning
 * into the label (#354): "label: why" is split on the first colon, and a label still over four
 * words is logged and shown whole as the explanation of "Other".
 */
function shortSkill(raw: string, detail: string): { skill: string; detail: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const colon = text.indexOf(':');
  const label = (colon === -1 ? text : text.slice(0, colon)).trim();
  const rest = colon === -1 ? '' : text.slice(colon + 1).trim();
  if (label && label.split(/\s+/).length <= MAX_SKILL_WORDS) {
    return { skill: label, detail: [rest, detail].filter(Boolean).join(' ') };
  }
  if (!loggedLongLabels.has(text) && loggedLongLabels.size < 1000) {
    loggedLongLabels.add(text);
    console.warn(`skill label over ${MAX_SKILL_WORDS} words, shown under ${OTHER_SKILL}: ${text.slice(0, 120)}`);
  }
  return { skill: OTHER_SKILL, detail: [text, detail].filter(Boolean).join(' ') };
}

/** Skills from a fit read or a stored row: objects, or plain strings from before #354. */
function toSkillNotes(raw: unknown, detailOf: (item: Record<string, unknown>) => unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const detail = isRecord(item) ? detailOf(item) : '';
    const note =
      typeof item === 'string'
        ? shortSkill(item, '')
        : isRecord(item) && typeof item.skill === 'string'
          ? shortSkill(item.skill, typeof detail === 'string' ? detail.trim() : '')
          : null;
    return note ? [note] : [];
  });
}

export function toMatchedSkills(raw: unknown): MatchedSkill[] {
  return toSkillNotes(raw, (item) => item.evidence).map(({ skill, detail }) => ({ skill, evidence: detail }));
}

export function toMissingSkills(raw: unknown): MissingSkill[] {
  return toSkillNotes(raw, (item) => item.postingQuote ?? item.posting_quote).map(({ skill, detail }) => ({
    skill,
    postingQuote: detail,
  }));
}

/** The labels of some skills, strings or objects, leaving out "Other", which is not a skill. */
export function skillNames(items: ReadonlyArray<string | { skill: string }>): string[] {
  return items
    .map((item) => (typeof item === 'string' ? item : item?.skill))
    .filter((skill): skill is string => typeof skill === 'string' && skill !== OTHER_SKILL);
}

/**
 * A skill label reduced to what names the skill, so "Microsoft SQL Server", "Postgres (Aurora)",
 * "React.js" and "SQL databases" compare as "sql server", "postgres", "react" and "sql".
 */
function skillKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(microsoft|ms) /, '')
    .replace(/ (databases?|language)$/, '')
    .replace(/\.?js$/, '')
    .trim();
}

/** A matched skill that implies another, so one read can't list that one as missing (#354). */
const IMPLIED_SKILLS: Array<[RegExp, string]> = [
  [/postgres|mysql|sql server/, 'sql'],
  [/typescript/, 'javascript'],
  [/^next$/, 'react'],
];

function coveredSkills(matched: MatchedSkill[]): Set<string> {
  const covered = new Set<string>();
  for (const key of skillNames(matched).map(skillKey)) {
    covered.add(key);
    for (const [pattern, implied] of IMPLIED_SKILLS) {
      if (pattern.test(key)) covered.add(implied);
    }
  }
  return covered;
}

/**
 * Map a fit-score result from the agent into a persisted JobAnalysis.
 * Pure function: keeps the score route and n8n route in agreement.
 */
export function analysisFromFit(
  fit: FitScoreOutput,
  context: { requiredSkills: string[]; preferredSkills: string[] },
): JobAnalysis {
  const matchedSkillDetails = toMatchedSkills(fit.matched_skills).slice(0, MAX_SKILLS);
  const covered = coveredSkills(matchedSkillDetails);
  const missingSkillDetails = toMissingSkills(fit.missing_skills)
    .filter(({ skill }) => !covered.has(skillKey(skill)))
    .slice(0, MAX_SKILLS);

  return {
    requiredSkills: unique(context.requiredSkills),
    preferredSkills: unique(context.preferredSkills),
    // "Other" is not a skill: it stays in the details only.
    matchedSkills: skillNames(matchedSkillDetails),
    missingSkills: skillNames(missingSkillDetails),
    matchedSkillDetails,
    missingSkillDetails,
    atsKeywords: fit.ats_keywords,
    fitSummary: fit.fit_summary,
    recommendedResumeAngle: fit.recommended_resume_angle,
    applyRecommendation:
      fit.apply_recommendation === 'apply'
        ? 'Apply with a customized resume and a short human-reviewed outreach message.'
        : fit.apply_recommendation === 'review'
          ? 'Review manually before deciding whether to apply.'
          : 'Hold off unless you can make a stronger truthful case.',
    confidenceScore: readConfidence(fit.confidence_score, fit.sub_signals),
    modelUsed: fit.model_used,
    subSignals: toSubSignals(fit.sub_signals),
  };
}

/**
 * A saved fit read in the agent's snake_case, for the Score fit answer: what was saved, not the
 * model's raw answer (#354).
 */
export function fitAnswerFields(analysis: JobAnalysis) {
  const signals = analysis.subSignals ?? {};
  return {
    matched_skills: analysis.matchedSkills,
    missing_skills: analysis.missingSkills,
    matched_skill_details: analysis.matchedSkillDetails ?? [],
    missing_skill_details: (analysis.missingSkillDetails ?? []).map(({ skill, postingQuote }) => ({
      skill,
      posting_quote: postingQuote,
    })),
    sub_signals: {
      skills_match: signals.skillsMatch ?? null,
      title_seniority: signals.titleSeniority ?? null,
      salary_fit: signals.salaryFit ?? null,
      sponsorship_likelihood: signals.sponsorshipLikelihood ?? null,
    },
    confidence_score: analysis.confidenceScore,
  };
}

/**
 * The saved details while the labels are exactly the ones saved with them (the labels leave
 * "Other" out), else details read from the labels themselves. The labels change under the
 * details in a row from before #354 ("label: why" strings, no details), and in one an API from
 * before #354 rescored after a rollback: new strings or the agent's objects, with the old
 * details left behind.
 */
function detailsFor<T extends { skill: string }>(labels: unknown, details: unknown, read: (raw: unknown) => T[]): T[] {
  const saved = read(details);
  const savedLabels = skillNames(saved);
  const unchanged =
    Array.isArray(labels) &&
    labels.length === savedLabels.length &&
    labels.every((label, index) => label === savedLabels[index]);
  return saved.length > 0 && unchanged ? saved : read(labels);
}

/** An analysis as any version stored it: its skill lists may hold strings or objects (#354). */
export type StoredAnalysis = Omit<
  JobAnalysis,
  'matchedSkills' | 'missingSkills' | 'matchedSkillDetails' | 'missingSkillDetails'
> & {
  matchedSkills: unknown;
  missingSkills: unknown;
  matchedSkillDetails?: unknown;
  missingSkillDetails?: unknown;
};

/**
 * A stored analysis in today's shape, so rows saved before #354 still render: short labels as
 * strings with their details alongside, confidence on 0–100, and no default sub-signals. The
 * job stores apply it on every read and write. `fitScore` is the job's: a pre-rank's skills
 * signal is its score.
 */
export function normalizeAnalysis(analysis: StoredAnalysis, fitScore?: number | null): JobAnalysis {
  const matchedSkillDetails = detailsFor(analysis.matchedSkills, analysis.matchedSkillDetails, toMatchedSkills);
  const missingSkillDetails = detailsFor(analysis.missingSkills, analysis.missingSkillDetails, toMissingSkills);
  return {
    ...analysis,
    matchedSkills: skillNames(matchedSkillDetails),
    missingSkills: skillNames(missingSkillDetails),
    matchedSkillDetails,
    missingSkillDetails,
    confidenceScore: readConfidence(analysis.confidenceScore, analysis.subSignals),
    subSignals: analysis.subSignals ? storedSubSignals(analysis.subSignals, analysis.modelUsed, fitScore) : undefined,
  };
}

function storedSubSignals(
  raw: JobAnalysisSubSignals,
  modelUsed: string,
  fitScore: number | null | undefined,
): JobAnalysisSubSignals {
  const signals = toSubSignals(raw);
  if (modelUsed !== PRERANK_MODEL) return signals;
  // The pre-rank only measures skills, and that signal is its score; before #354 it saved a 50
  // for the other three.
  return {
    ...signals,
    skillsMatch: fitScore === undefined ? signals.skillsMatch : toSignal(fitScore),
    titleSeniority: null,
  };
}

export function parseJobDescription(descriptionText: string): ParsedJobOutput {
  const description = descriptionText.trim();
  const extractedSkills = extractKeywords(description);
  const requiredSkills = unique(extractedSkills.slice(0, 5));
  const preferredSkills = unique(extractedSkills.slice(5, 8));

  return {
    company: inferCompany(description),
    title: inferTitle(description),
    required_skills: requiredSkills,
    preferred_skills: preferredSkills,
    responsibilities: buildResponsibilities(unique([...requiredSkills, ...preferredSkills])),
    seniority: inferSeniority(description),
    cloud_tools: extractedSkills.filter((keyword) => /Azure|AWS|Google Cloud/i.test(keyword)),
    automation_tools: extractedSkills.filter((keyword) => /n8n|Zapier|Make|workflow/i.test(keyword)),
    summary: `Parsed ${extractedSkills.length} keywords from the job description and grouped them into structured fields.`,
  };
}

export function validateParsedJobOutput(value: unknown): value is ParsedJobOutput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as ParsedJobOutput;
  return (
    (record.company === null || typeof record.company === 'string') &&
    (record.title === null || typeof record.title === 'string') &&
    (record.location == null || typeof record.location === 'string') &&
    Array.isArray(record.required_skills) &&
    Array.isArray(record.preferred_skills) &&
    Array.isArray(record.responsibilities) &&
    typeof record.seniority === 'string' &&
    Array.isArray(record.cloud_tools) &&
    Array.isArray(record.automation_tools) &&
    typeof record.summary === 'string'
  );
}

export function validateFitScoreOutput(value: unknown): value is FitScoreOutput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as FitScoreOutput;
  return (
    typeof record.fit_score === 'number' &&
    Array.isArray(record.matched_skills) &&
    Array.isArray(record.missing_skills) &&
    Array.isArray(record.ats_keywords) &&
    typeof record.fit_summary === 'string' &&
    typeof record.recommended_resume_angle === 'string' &&
    (record.apply_recommendation === 'apply' ||
      record.apply_recommendation === 'review' ||
      record.apply_recommendation === 'pass') &&
    (typeof record.confidence_score === 'number' || record.confidence_score === null) &&
    typeof record.model_used === 'string'
  );
}

export function validateJobAnalysis(value: unknown): value is JobAnalysis {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as JobAnalysis;
  return (
    Array.isArray(record.requiredSkills) &&
    Array.isArray(record.preferredSkills) &&
    Array.isArray(record.matchedSkills) &&
    Array.isArray(record.missingSkills) &&
    Array.isArray(record.atsKeywords) &&
    typeof record.fitSummary === 'string' &&
    typeof record.recommendedResumeAngle === 'string' &&
    typeof record.applyRecommendation === 'string' &&
    (typeof record.confidenceScore === 'number' || record.confidenceScore === null) &&
    typeof record.modelUsed === 'string'
  );
}

