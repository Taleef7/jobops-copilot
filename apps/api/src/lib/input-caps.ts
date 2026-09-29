/**
 * Size limits on user text (#345). Stored text has a hard ceiling, and what reaches the
 * LLM is cut shorter still: the budget used to charge a flat cent per call however long
 * the posting or résumé was.
 */

/** The most job text sent to the LLM in one call. */
export const LLM_JOB_TEXT_MAX = 20_000;
/** The most résumé or profile text sent to the LLM in one call. */
export const LLM_PROFILE_TEXT_MAX = 15_000;
/** The longest posting, résumé or profile text that is stored at all. */
export const STORED_TEXT_MAX = 100_000;
/** Short fields on a job. */
export const JOB_FIELD_MAX = 300;
export const JOB_NOTE_MAX = 10_000;

export const TOO_LONG_MESSAGE = `This text is too long. The limit is ${STORED_TEXT_MAX.toLocaleString('en-US')} characters.`;

const FIELD_CAPS: Record<string, number> = {
  description_text: LLM_JOB_TEXT_MAX,
  job_description: LLM_JOB_TEXT_MAX,
  description: LLM_JOB_TEXT_MAX,
  job_context: LLM_JOB_TEXT_MAX,
  context: LLM_JOB_TEXT_MAX, // the research agent's job description
  resume_text: LLM_PROFILE_TEXT_MAX,
  profile_text: LLM_PROFILE_TEXT_MAX,
  resume_summary: LLM_PROFILE_TEXT_MAX,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Specialist payloads nest the job (`input.job.description_text`), sometimes in arrays.
const MAX_DEPTH = 4;

function capValue(value: unknown, depth: number): { value: unknown; truncated: boolean } {
  if (depth > MAX_DEPTH) return { value, truncated: false };
  if (Array.isArray(value)) {
    let truncated = false;
    const items = value.map((item) => {
      const capped = capValue(item, depth + 1);
      truncated ||= capped.truncated;
      return capped.value;
    });
    return { value: items, truncated };
  }
  if (!isPlainObject(value)) return { value, truncated: false };
  let truncated = false;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const cap = FIELD_CAPS[key];
    if (cap !== undefined && typeof field === 'string' && field.length > cap) {
      result[key] = field.slice(0, cap);
      truncated = true;
    } else {
      const nested = capValue(field, depth + 1);
      result[key] = nested.value;
      truncated ||= nested.truncated;
    }
  }
  return { value: result, truncated };
}

/**
 * Cut the known text fields of an agent request to their LLM limits, wherever they sit in
 * nested objects and arrays (up to a few levels). Other fields are untouched.
 */
export function capAgentPayload(payload: unknown): { payload: unknown; truncated: boolean } {
  const { value, truncated } = capValue(payload, 0);
  return truncated ? { payload: value, truncated } : { payload, truncated: false };
}

/** True when a string is longer than `max` characters. */
export function isTooLong(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > max;
}
