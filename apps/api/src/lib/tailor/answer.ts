/**
 * The agent's answer to POST /tailor-resume (#351), as `TailorResumeResponse` in
 * services/agent/app/schemas.py defines it: edits to lines of the base résumé, never a résumé.
 */
export interface TailorEditAnswer {
  source_path: string;
  old_text: string;
  new_text: string;
  rationale: string;
}

export interface TailorAnswer {
  change_summary: string;
  edits: TailorEditAnswer[];
  highlight_orders: Array<{ work_index: number; highlight_order: number[] }>;
  skills_order: string[];
  added_skills: Array<{ skill: string; category: string }>;
  gaps: string[];
  model_used?: string;
}

/** The request the API sends: the posting, and the base résumé as read-only facts and lines. */
export interface TailorAgentRequest {
  job_title: string;
  company: string;
  description_text: string;
  facts: string;
  lines: Array<{ path: string; text: string }>;
  skills: string[];
  skill_categories: string[];
  keywords: string[];
  confirmed_keywords: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isList = <T>(value: unknown, item: (entry: unknown) => entry is T): value is T[] =>
  Array.isArray(value) && value.every(item);

const isEdit = (value: unknown): value is TailorEditAnswer =>
  isRecord(value) &&
  isText(value.source_path) &&
  isText(value.old_text) &&
  isText(value.new_text) &&
  isText(value.rationale);

const isOrder = (value: unknown): value is TailorAnswer['highlight_orders'][number] =>
  isRecord(value) &&
  Number.isInteger(value.work_index) &&
  isList(value.highlight_order, (entry): entry is number => Number.isInteger(entry));

const isAddedSkill = (value: unknown): value is TailorAnswer['added_skills'][number] =>
  isRecord(value) && isText(value.skill) && isText(value.category);

/**
 * The agent's answer when it refused the posting as a prompt injection (INJECTION_ACTION=refuse;
 * services/agent/app/chains/tailor_resume.py): no edits, and this summary.
 */
export function isInjectionRefusal(answer: TailorAnswer): boolean {
  return answer.edits.length === 0 && answer.change_summary.startsWith('Not tailored: suspected prompt injection');
}

/** An answer the API can apply. Anything else is an unusable answer (503, nothing saved). */
export function isTailorAnswer(value: unknown): value is TailorAnswer & { model_used: string } {
  return (
    isRecord(value) &&
    isText(value.change_summary) &&
    isList(value.edits, isEdit) &&
    isList(value.highlight_orders, isOrder) &&
    isList(value.skills_order, isText) &&
    isList(value.added_skills, isAddedSkill) &&
    isList(value.gaps, isText) &&
    isText(value.model_used)
  );
}
