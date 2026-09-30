/**
 * Valid answers for a fake agent in tests. Since #349 an answer the app can't use is an
 * error (503), not a cue to make one up, so a fake agent has to answer like the real one.
 */
export const FAKE_PARSED_JOB = {
  company: 'Acme',
  title: 'Engineer',
  required_skills: ['Go', 'Postgres'],
  preferred_skills: ['Kafka'],
  responsibilities: ['Build APIs'],
  seniority: 'mid',
  cloud_tools: [],
  automation_tools: [],
  summary: 'Build APIs in Go.',
};

export const FAKE_FIT_SCORE = {
  fit_score: 72,
  matched_skills: ['Go', 'Postgres'],
  missing_skills: ['Kafka'],
  ats_keywords: ['Go', 'Postgres', 'Kafka'],
  fit_summary: 'Strong on Go and Postgres; no Kafka yet.',
  recommended_resume_angle: 'Lead with the Go services you built.',
  apply_recommendation: 'apply',
  confidence_score: 70,
  model_used: 'openai:gpt-5.4-nano',
};

export const FAKE_STRUCTURED_RESUME = {
  basics: { name: 'Ada Lovelace', email: 'ada@example.com', summary: 'Backend engineer.' },
  work: [{ company: 'Globex', position: 'Backend Engineer', start_date: '2022-01', highlights: ['Built the billing API'] }],
  education: [],
  skills: [{ category: 'Languages', skills: ['Go', 'Python'] }],
};

export const FAKE_OUTREACH_DRAFT = {
  subject: 'Backend Engineer role at Acme',
  draft_text: 'Hi there, I build backend services in Go and would like to talk about the role.',
};

/** The JSON a fake agent should answer for a request path. */
export function fakeAgentAnswer(path: string | undefined): unknown {
  if (path?.startsWith('/parse-job')) return FAKE_PARSED_JOB;
  if (path?.startsWith('/score-fit')) return FAKE_FIT_SCORE;
  if (path?.startsWith('/parse-resume')) return FAKE_STRUCTURED_RESUME;
  if (path?.startsWith('/draft-outreach')) return FAKE_OUTREACH_DRAFT;
  return {};
}
