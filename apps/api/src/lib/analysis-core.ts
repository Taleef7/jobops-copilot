import type { JobAnalysis } from '@/types';

export type ParsedJobSeniority = 'junior' | 'mid' | 'senior' | 'lead' | 'unknown';

export interface ParsedJobOutput {
  company: string | null;
  title: string | null;
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
    skills_match?: number;
    title_seniority?: number;
    salary_fit?: number;
    sponsorship_likelihood?: number;
  };
  matched_skills: string[];
  missing_skills: string[];
  ats_keywords: string[];
  fit_summary: string;
  recommended_resume_angle: string;
  apply_recommendation: 'apply' | 'review' | 'pass';
  confidence_score: number;
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

/**
 * Map a fit-score result (mock OR real LLM agent) into a persisted JobAnalysis.
 * Pure function: keeps the score route and n8n route in agreement.
 */
export function analysisFromFit(
  fit: FitScoreOutput,
  context: { requiredSkills: string[]; preferredSkills: string[] },
): JobAnalysis {
  return {
    requiredSkills: unique(context.requiredSkills),
    preferredSkills: unique(context.preferredSkills),
    matchedSkills: fit.matched_skills,
    missingSkills: fit.missing_skills,
    atsKeywords: fit.ats_keywords,
    fitSummary: fit.fit_summary,
    recommendedResumeAngle: fit.recommended_resume_angle,
    applyRecommendation:
      fit.apply_recommendation === 'apply'
        ? 'Apply with a customized resume and a short human-reviewed outreach message.'
        : fit.apply_recommendation === 'review'
          ? 'Review manually before deciding whether to apply.'
          : 'Hold off unless you can make a stronger truthful case.',
    confidenceScore: fit.confidence_score,
    modelUsed: fit.model_used,
    subSignals: fit.sub_signals
      ? {
          skillsMatch: fit.sub_signals.skills_match ?? 50,
          titleSeniority: fit.sub_signals.title_seniority ?? 50,
          salaryFit: fit.sub_signals.salary_fit ?? 50,
          sponsorshipLikelihood: fit.sub_signals.sponsorship_likelihood ?? 50,
        }
      : {
          skillsMatch: 50,
          titleSeniority: 50,
          salaryFit: 50,
          sponsorshipLikelihood: 50,
        },
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
    typeof record.confidence_score === 'number' &&
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

