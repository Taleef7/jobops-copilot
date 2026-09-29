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
  resume_text: LLM_PROFILE_TEXT_MAX,
  profile_text: LLM_PROFILE_TEXT_MAX,
  resume_summary: LLM_PROFILE_TEXT_MAX,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capObject(source: Record<string, unknown>, depth: number): { value: Record<string, unknown>; truncated: boolean } {
  let truncated = false;
  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(source)) {
    const cap = FIELD_CAPS[key];
    if (cap !== undefined && typeof field === 'string' && field.length > cap) {
      value[key] = field.slice(0, cap);
      truncated = true;
    } else if (depth > 0 && isPlainObject(field)) {
      const nested = capObject(field, depth - 1);
      value[key] = nested.value;
      truncated ||= nested.truncated;
    } else {
      value[key] = field;
    }
  }
  return { value, truncated };
}

/**
 * Cut the known text fields of an agent request to their LLM limits, at the top level and
 * one level down (the specialist agents take an `input` object). Other fields are untouched.
 */
export function capAgentPayload(payload: unknown): { payload: unknown; truncated: boolean } {
  if (!isPlainObject(payload)) return { payload, truncated: false };
  const { value, truncated } = capObject(payload, 1);
  return truncated ? { payload: value, truncated } : { payload, truncated: false };
}

/** True when a string is longer than `max` characters. */
export function isTooLong(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > max;
}
