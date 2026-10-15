import type { CoverLetterLength, JobRecord, StructuredResume } from '@/types';
import { buildTailorRequest } from '@/lib/tailor/request';

/**
 * The agent's POST /cover-letter (#416), as `CoverLetterRequest` and `CoverLetterResponse` in
 * services/agent/app/schemas.py define them: the letter's body paragraphs, never a frame.
 */
export interface CoverLetterAgentRequest {
  job_title: string;
  company: string;
  description_text: string;
  /** The base résumé's facts: roles with company and dates, education, projects, certificates. */
  facts: string;
  /** The summary and every bullet, as written. */
  lines: string[];
  skills: string[];
  /** The posting's keywords from the fit read. */
  keywords: string[];
  confirmed_keywords: string[];
  length: CoverLetterLength;
}

export interface CoverLetterAnswer {
  paragraphs: string[];
  model_used: string;
  /** The agent refused the posting as a prompt injection (INJECTION_ACTION=refuse). */
  refused?: boolean;
}

/**
 * What the agent is sent: the posting, and the base résumé as the tailoring sends it (the same
 * facts, lines and skills, within the same limits), so the letter has the same evidence.
 */
export function buildCoverLetterRequest(
  base: StructuredResume,
  job: JobRecord,
  confirmedKeywords: string[],
  length: CoverLetterLength,
): CoverLetterAgentRequest {
  const tailor = buildTailorRequest(base, job, confirmedKeywords);
  return {
    job_title: tailor.job_title,
    company: tailor.company,
    description_text: tailor.description_text,
    facts: tailor.facts,
    lines: tailor.lines.map((line) => line.text),
    skills: tailor.skills,
    keywords: tailor.keywords,
    confirmed_keywords: tailor.confirmed_keywords,
    length,
  };
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** An answer the API can check. Anything else is an unusable answer (503, nothing saved). */
export function isCoverLetterAnswer(value: unknown): value is CoverLetterAnswer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const answer = value as Record<string, unknown>;
  return (
    Array.isArray(answer.paragraphs) &&
    answer.paragraphs.every(isText) &&
    isText(answer.model_used) &&
    (answer.refused === undefined || typeof answer.refused === 'boolean')
  );
}
