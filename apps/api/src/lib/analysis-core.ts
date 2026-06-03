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
  matched_skills: string[];
  missing_skills: string[];
  ats_keywords: string[];
  fit_summary: string;
  recommended_resume_angle: string;
  apply_recommendation: 'apply' | 'review' | 'pass';
  confidence_score: number;
  model_used: string;
}

const keywordCatalog = [
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
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function extractKeywords(text: string): string[] {
  return keywordCatalog.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
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
 * Map a parsed job description (from the mock parser OR the real LLM agent)
 * into a persisted JobAnalysis record. Pure function so both paths agree.
 */
export function analysisFromParsed(parsed: ParsedJobOutput): JobAnalysis {
  return {
    requiredSkills: parsed.required_skills,
    preferredSkills: parsed.preferred_skills,
    matchedSkills: [],
    missingSkills: parsed.required_skills.slice(0, 3),
    atsKeywords: unique([...parsed.required_skills, ...parsed.preferred_skills]).slice(0, 6),
    fitSummary: parsed.summary,
    recommendedResumeAngle: 'Review the parsed job description and map it to truthful resume evidence before applying.',
    applyRecommendation: 'Review manually before deciding whether to apply.',
    confidenceScore: 48,
    modelUsed: 'mock-analysis-v1',
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
  };
}

function baseAnalysis(descriptionText: string): JobAnalysis {
  return analysisFromParsed(parseJobDescription(descriptionText));
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

export function buildAnalysisFromParse(descriptionText: string): JobAnalysis {
  return baseAnalysis(descriptionText);
}

export function scoreJobFit(input: {
  descriptionText: string;
  resumeText: string;
  profileText: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  atsKeywords?: string[];
}): FitScoreOutput {
  const parsed = parseJobDescription(input.descriptionText);
  const requiredSkills = unique(input.requiredSkills ?? parsed.required_skills);
  const preferredSkills = unique(input.preferredSkills ?? parsed.preferred_skills);
  const resumeProfileText = `${input.resumeText} ${input.profileText}`.toLowerCase();
  const matchedSkills = requiredSkills.filter((skill) => resumeProfileText.includes(skill.toLowerCase()));
  const missingSkills = requiredSkills.filter((skill) => !matchedSkills.includes(skill));
  const atsKeywords = unique([
    ...(input.atsKeywords ?? []),
    ...requiredSkills,
    ...preferredSkills,
    ...extractKeywords(resumeProfileText),
  ]).slice(0, 8);

  const fitScore = clamp(55 + matchedSkills.length * 9 - missingSkills.length * 5, 30, 98);
  const confidenceScore = clamp(60 + matchedSkills.length * 6 - missingSkills.length * 3, 35, 96);
  const topMatches = matchedSkills.slice(0, 3);

  return {
    fit_score: fitScore,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    ats_keywords: atsKeywords,
    fit_summary: matchedSkills.length
      ? `Matched ${matchedSkills.length} of ${requiredSkills.length} required skills and left the rest for truthful review.`
      : 'The resume/profile text does not strongly overlap with the required skills, so this should stay a cautious review.',
    recommended_resume_angle: topMatches.length
      ? `Lead with truthful experience around ${topMatches.join(', ')} and avoid overstating gaps.`
      : 'Focus on truthful overlap, keyword alignment, and the strongest evidence from the resume.',
    apply_recommendation: fitScore >= 80 ? 'apply' : fitScore >= 65 ? 'review' : 'pass',
    confidence_score: confidenceScore,
    model_used: 'mock-fit-scorer-v1',
  };
}

export function buildAnalysisFromScore(input: {
  descriptionText: string;
  resumeText: string;
  profileText: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  atsKeywords?: string[];
}): JobAnalysis {
  const fit = scoreJobFit(input);
  const parsed = parseJobDescription(input.descriptionText);

  return analysisFromFit(fit, {
    requiredSkills: input.requiredSkills ?? parsed.required_skills,
    preferredSkills: input.preferredSkills ?? parsed.preferred_skills,
  });
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
    typeof record.confidenceScore === 'number' &&
    typeof record.modelUsed === 'string'
  );
}

export function getDefaultAnalysis(descriptionText: string): JobAnalysis {
  return baseAnalysis(descriptionText);
}
