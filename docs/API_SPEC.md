# API Spec

The API exposes jobs and AI endpoints backed by either the local file store or PostgreSQL, depending on whether `DATABASE_URL` is configured. In the default local setup the file store keeps the CRM state persistent between API restarts. When `DATABASE_URL` is present, the API switches to the Postgres-backed store and reports that in `/api/health`.

### Field casing

The casing is intentionally split by layer, and the examples below reflect the real payloads:

- **CRM resources are `camelCase`** — the jobs routes (`/api/jobs`), the stored `analysis` object, saved reports (`GET /api/reports`), and outreach records. These are the API's own persisted shapes.
- **The AI and n8n endpoints are `snake_case`** — `/api/ai/parse-job`, `/api/ai/score-fit`, `/api/ai/draft-outreach`, `/api/ai/generate-weekly-report`, and `/api/n8n/*` return (and accept) the Python agent service's payload as a passthrough, which is `snake_case` end to end (e.g. `fit_score`, `required_skills`). The web app reads the `camelCase` stored `analysis` for display rather than these raw responses.

## Health

### `GET /api/health`

Returns a basic service status response.

Example response:

```json
{
  "ok": true,
  "service": "jobops-copilot-api",
  "mode": "postgres",
  "timestamp": "2026-05-17T16:58:10.636Z"
}
```

The `mode` value will be `file` for the local fallback store or `postgres` when `DATABASE_URL` is configured.

## Jobs

### `GET /api/jobs`

Returns the current job list from the active persistent store.

Example response:

```json
{
  "jobs": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "company": "Northwind Labs",
      "title": "AI Automation Engineer",
      "status": "shortlisted",
      "priority": "high",
      "fitScore": 91
    }
  ]
}
```

Each job object includes the CRM fields, the latest analysis, and any outreach drafts.

### `POST /api/jobs`

Creates a new job.

Example request:

```json
{
  "jobUrl": "https://example.com/job",
  "source": "manual",
  "company": "Example Company",
  "title": "AI Automation Engineer",
  "location": "Remote",
  "employmentType": "Full-time",
  "workplaceType": "remote",
  "priority": "high",
  "notes": "Worth prioritizing because it matches the target stack.",
  "descriptionText": "Full job description here"
}
```

Validation rules:

- `company`, `title`, and `descriptionText` are required.
- `jobUrl`, when provided, must be a valid URL and unique.
- `priority`, when provided, must be `high`, `medium`, or `low`.
- `workplaceType`, when provided, must be `remote`, `hybrid`, `onsite`, or `flexible`.

Example response:

```json
{
  "job": {
    "id": "uuid",
    "company": "Example Company",
    "title": "AI Automation Engineer",
    "status": "discovered",
    "priority": "high"
  }
}
```

### `GET /api/jobs/:id`

Returns a single job with its analysis and outreach data.

Example response:

```json
{
  "job": {
    "id": "uuid",
    "company": "Example Company",
    "title": "AI Automation Engineer",
    "analysis": {
      "requiredSkills": ["TypeScript"],
      "preferredSkills": ["n8n"],
      "matchedSkills": [],
      "missingSkills": ["TypeScript"],
      "atsKeywords": ["TypeScript"],
      "fitSummary": "Initial placeholder analysis waiting for AI processing.",
      "recommendedResumeAngle": "Emphasize truthful, relevant experience from the current resume.",
      "applyRecommendation": "Review manually before deciding whether to apply.",
      "confidenceScore": 48,
      "modelUsed": "mock-analysis-v1"
    },
    "outreach": []
  }
}
```

### `PATCH /api/jobs/:id`

Updates job status, priority, notes, fit score, or next action metadata.

Example request:

```json
{
  "status": "shortlisted",
  "priority": "high",
  "notes": "Updated after first review.",
  "nextAction": "Review fit and prepare outreach draft.",
  "nextActionDue": "2026-05-18T15:00:00Z"
}
```

Validation rules:

- `status` must match one of the CRM pipeline states.
- `priority` must be `high`, `medium`, or `low`.
- `fitScore` must be a number between 0 and 100.
- `nextActionDue` must be a valid date if provided.

### `POST /api/jobs/extract`

Fetches a user-supplied job posting URL server-side and returns structured autofill fields for the **New job** form's "Autofill" button. The fetch runs behind an SSRF guard (loopback/private/link-local addresses are blocked, with a connect-time DNS-rebinding re-check), caps the response at 2 MB, follows at most 3 redirects, and accepts only `text/html`. This route sits behind the strict AI/discovery rate limiter.

Example request:

```json
{
  "url": "https://example.com/jobs/ai-automation-engineer"
}
```

The HTML is parsed by a tiered extractor — JSON-LD `JobPosting` → OpenGraph/meta tags → a heuristic DOM pass — and the first tier to supply a given field wins.

Example response:

```json
{
  "title": "AI Automation Engineer",
  "company": "Northwind Labs",
  "location": "Remote",
  "descriptionText": "Build internal automations...",
  "workplaceType": "remote",
  "source": "jsonld"
}
```

Response fields (every field except `source` is optional and omitted when not found):

- `title`, `company`, `location`, `descriptionText` — extracted strings.
- `workplaceType` — one of `remote`, `hybrid`, `onsite`, `flexible` (currently only set to `remote`, from a JSON-LD `TELECOMMUTE` location).
- `source` — the highest-priority tier that contributed at least one field: `jsonld`, `opengraph`, `heuristic`, or `none`.

When nothing could be extracted the body is just `{ "source": "none" }`.

Validation / notes:

- `url` is required; a missing or empty value returns `400` `{ "error": "A job URL is required." }`.
- A blocked, unreachable, non-HTML, oversized, or otherwise unreadable URL returns `400` with a human-readable `error` (e.g. `"That URL is not an HTML page."`, `"That page is too large to read."`, `"Too many redirects."`).

### `GET /api/jobs/:id/agent-outputs`

Returns the persisted AI-agent outputs for a job — the saved results of the interview-prep, research, and skill-gap agents, so they survive a page reload. Ownership-guarded: a job that does not exist or is not owned by the caller returns `404` `{ "error": "Job not found" }`.

Example response:

```json
{
  "outputs": [
    {
      "jobId": "11111111-1111-4111-8111-111111111111",
      "kind": "interview_prep",
      "payload": {},
      "modelUsed": "claude-sonnet",
      "createdAt": "2026-06-25T12:00:00.000Z"
    }
  ]
}
```

Outputs are returned newest-first. `kind` is one of `interview_prep`, `research`, or `skill_gap` (at most one row per `kind` per job — a re-run overwrites the previous output). `payload` is the raw agent response for that kind; `modelUsed` is omitted when unknown.

> **No `DELETE` for jobs.** Jobs are never hard-deleted — they are archived by `PATCH`-ing `status` to `archived`, which preserves history and analytics. The only resource with a `DELETE` endpoint is saved searches (`DELETE /api/saved-searches/:id`).

## AI

### Edge guards (rate limiting & cost ceiling)

The `/api/ai/*` and `/api/discovery/*` routes are protected (Phase 2 · Workstream G):

- **Rate limiting** — a lenient global limit applies to all routes, and a stricter limit
  guards the expensive AI/discovery routes. Requests are keyed by the Clerk user id (with
  an IPv6-safe IP fallback). Exceeding the window returns **`429`**
  `{ "error": "Too many requests, slow down." }`. Tunable via `RATE_LIMIT_WINDOW_MS`,
  `RATE_LIMIT_MAX`, `RATE_LIMIT_AI_MAX`.
- **Daily AI budget** — each paid `/api/ai/*` call accrues a small per-operation cost
  estimate against the user's UTC-day total (atomic reserve-before-work). Once the user
  reaches `AI_DAILY_BUDGET_USD` they get **`429`** `{ "error": "Daily AI budget reached" }`
  until the day rolls over. The n8n intake path consumes the same budget. Both guards fail
  open if their store is unavailable. `helmet` security headers are also set.

### `POST /api/ai/parse-job`

Parses raw text into structured job fields.

Example request:

```json
{
  "job_id": "uuid",
  "description_text": "Build internal automations..."
}
```

If `job_id` is provided, the parsed analysis is saved back to the current job record.

Example response:

```json
{
  "job_id": "uuid",
  "company": "Northwind Labs",
  "title": "AI Automation Engineer",
  "required_skills": ["TypeScript", "Azure Functions", "n8n"],
  "preferred_skills": ["LLM"],
  "responsibilities": [
    "Contribute to typescript initiatives.",
    "Contribute to azure functions initiatives."
  ],
  "seniority": "mid",
  "cloud_tools": ["Azure Functions"],
  "automation_tools": ["n8n"],
  "summary": "Parsed 4 keywords from the job description and grouped them into structured fields."
}
```

Current response fields:

- `company`
- `title`
- `required_skills`
- `preferred_skills`
- `responsibilities`
- `seniority`
- `cloud_tools`
- `automation_tools`
- `summary`

### `POST /api/ai/score-fit`

Scores a job against the resume and profile text.

Example request:

```json
{
  "job_id": "uuid",
  "resume_text": "Resume text",
  "profile_text": "Profile text"
}
```

`job_id` is required because the API uses the stored job description as the comparison target. When the score is generated, the API saves the structured analysis and updates the job `fit_score`.

Example response:

```json
{
  "job_id": "uuid",
  "fit_score": 82,
  "matched_skills": ["TypeScript"],
  "missing_skills": ["n8n"],
  "ats_keywords": ["TypeScript", "n8n"],
  "fit_summary": "Matched 1 of 2 required skills and left the rest for truthful review.",
  "recommended_resume_angle": "Lead with truthful experience around TypeScript and avoid overstating gaps.",
  "apply_recommendation": "review",
  "confidence_score": 69,
  "model_used": "mock-fit-scorer-v1"
}
```

Current response fields:

- `fit_score`
- `matched_skills`
- `missing_skills`
- `ats_keywords`
- `fit_summary`
- `recommended_resume_angle`
- `apply_recommendation`
- `confidence_score`
- `model_used`

### `POST /api/ai/draft-outreach`

Creates a human-reviewed outreach draft.

Example request:

```json
{
  "job_id": "uuid",
  "message_type": "recruiter_email",
  "contact_name": "Optional Name",
  "contact_role": "Optional Role",
  "contact_email": "optional@example.com",
  "job_context": "Optional context from the current job description",
  "resume_summary": "Optional context from the user's resume snapshot"
}
```

Current response shape:

```json
{
  "subject": "Interest in the role and a quick introduction",
  "draft_text": "Hi Optional Name, ...",
  "safety_notes": "Draft only. Human review is required before sending.",
  "outreach_id": "uuid",
  "job_id": "uuid",
  "gmail_draft_status": "created",
  "gmail_draft_id": "gmail-draft-id",
  "gmail_draft_message": "Gmail draft created in the connected mailbox."
}
```

If `job_id` is supplied and matches an existing job, the draft is also stored in the `outreach` table with `status: "drafted"`. If the job ID does not resolve, the endpoint still returns the generated draft but does not persist it.

When the job exists, the saved job row also moves into the `outreach_drafted` stage so the CRM reflects that the draft is waiting for review.

If `GMAIL_DRAFTS_ENABLED=true` and a recipient email is supplied, the API also attempts to create a Gmail draft using the Gmail API. The response includes `gmail_draft_status`, `gmail_draft_id`, and `gmail_draft_message` so the UI can show whether that optional side effect was created, skipped, or failed.

The generated draft passes output guardrails (Phase 2 · Workstream I): `safety_notes` may
carry `BLOCKED by moderation: …` (the body is withheld for human review) or
`UNVERIFIED claims: …` when a groundedness self-check finds claims unsupported by the job/
resume context. Contact-PII in the inputs is redacted before the LLM call.

### `PATCH /api/outreach/:id`

Updates a single outreach draft in the inbox.

Example request:

```json
{
  "status": "approved"
}
```

Allowed `status` values:

- `drafted`
- `approved`
- `sent`
- `skipped`

This endpoint updates the draft state manually. Setting `status` to `sent` records the send timestamp but does not send mail automatically.

### `POST /api/ai/agents/interview-prep`, `POST /api/ai/agents/research`, `POST /api/ai/agents/skill-gap`

Run the specialized agents for a single job. Each requires `job_id`, and the job must exist and be owned by the caller. The stored job description, company, and title supply the agent context; `resume_text` (where applicable) falls back to the saved profile resume.

Example request:

```json
{
  "job_id": "uuid",
  "resume_text": "Optional resume text override"
}
```

`research` takes only `job_id`; `interview-prep` and `skill-gap` also accept an optional `resume_text`.

On success each agent returns its raw `snake_case` agent payload and **persists that output** (keyed by job + kind) so it is restored on reload via `GET /api/jobs/:id/agent-outputs`. Persistence is best-effort and never fails the request.

Validation / notes:

- Missing `job_id` → `400` `{ "error": "job_id is required" }`.
- Unknown or unowned job → `404` `{ "error": "Job not found" }`.
- When the agent service is not configured → `503` `{ "error": "The AI agent service is not configured. Set AGENT_SERVICE_URL and a provider key to enable the agents." }`.

### `POST /api/ai/assistant/chat`

Server-Sent Events (`text/event-stream`) passthrough for the global assistant chat widget. Protected by the strict rate limiter and the daily AI budget. The request carries the running conversation and an optional `jobId`; when supplied (and owned), the API builds a compact, ownership-checked context block from that job (title, company, location, fit score/summary, matched/missing skills, and a truncated description) and forwards it to the agent.

Example request:

```json
{
  "messages": [
    { "role": "user", "content": "What should I emphasize for this role?" }
  ],
  "jobId": "uuid"
}
```

The response is an event stream that emits one or more `token` events as the answer is generated, then a terminal `done` event (or an `error` event on failure). Each `messages` entry needs a `role` (`user` or `assistant`) and a string `content`.

Validation / notes:

- Empty or invalid `messages` → `400` `{ "error": "messages is required" }`.
- When the agent service is not configured → `503` `{ "error": "The AI agent service is not configured. Set AGENT_SERVICE_URL and a provider key to enable the assistant." }`.
- A failed job-context build never breaks the chat — the context is simply omitted.

### `POST /api/ai/generate-weekly-report`

Builds a weekly report draft from CRM data.

Example request:

```json
{
  "week_start": "2026-05-11",
  "week_end": "2026-05-17"
}
```

Current response shape:

```json
{
  "summary": "Weekly report draft for 2026-05-11 through 2026-05-17.",
  "metrics": {
    "jobs_discovered": 3,
    "jobs_shortlisted": 1,
    "jobs_applied": 0,
    "outreach_drafted": 1,
    "outreach_sent": 0,
    "responses_received": 0,
    "interviews": 0
  },
  "common_missing_skills": ["n8n"],
  "recommended_next_actions": ["Review the highest-priority shortlisted jobs."],
  "report_markdown": "# Weekly report...",
  "report_id": "44444444-4444-4444-8444-444444444444",
  "created_at": "2026-05-17T18:00:00.000Z",
  "report_url": "http://127.0.0.1:4000/api/reports/44444444-4444-4444-8444-444444444444/export"
}
```

This endpoint now saves the weekly report through the active store, exports the markdown artifact, and returns the persisted record metadata for the dashboard or downstream automations.

### `GET /api/reports`

Returns the saved weekly report history in newest-first order.

Example response:

```json
{
  "reports": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "weekStart": "2026-05-11",
      "weekEnd": "2026-05-17",
      "jobsDiscovered": 14,
      "jobsShortlisted": 5,
      "jobsApplied": 2,
      "outreachDrafted": 4,
      "outreachSent": 1,
      "responsesReceived": 1,
      "interviews": 1,
      "commonMissingSkills": ["Azure Functions", "n8n"],
      "recommendations": ["Tailor the headline toward operations automation and workflow systems."],
      "reportMarkdown": "# Weekly report...",
      "reportUrl": "http://127.0.0.1:4000/api/reports/44444444-4444-4444-8444-444444444444/export",
      "createdAt": "2026-05-17T18:00:00.000Z"
    }
  ]
}
```

### `GET /api/reports/latest`

Returns the most recently generated weekly report. The response is `{ "report": { ... } }`, or `404` if no report has been saved yet.

### `GET /api/reports/:reportId/export`

Streams the saved weekly report markdown for the requested report ID. The same route is used for the local export link in development.

### `POST /api/n8n/job-intake`

Creates a CRM job from a webhook payload, parses the description, and optionally scores fit when resume and profile context are included.

Required header when configured:

- `X-N8N-Webhook-Secret: <secret>`

Example request:

```json
{
  "company": "Northwind Labs",
  "title": "AI Automation Engineer",
  "description_text": "Build internal automations using TypeScript, Azure Functions, and n8n.",
  "job_url": "https://example.com/jobs/ai-automation-engineer",
  "source": "job board",
  "resume_text": "TypeScript, Azure Functions, and n8n experience",
  "profile_text": "workflow automation and serverless delivery"
}
```

Current response shape:

```json
{
  "workflow": "job-intake",
  "job": {},
  "parsed": {},
  "fit_status": "scored",
  "fit_message": "Fit scoring completed with a score of 91.",
  "notification": "Job created, parsed, scored, and queued for human review."
}
```

If a job already exists with the same `job_url`, the endpoint returns `409` and does not create a duplicate.

### `POST /api/n8n/follow-up-reminders`

Returns the jobs whose follow-up dates are due now or overdue.

Example request:

```json
{
  "as_of": "2026-05-17T09:00:00.000Z"
}
```

Current response shape:

```json
{
  "workflow": "follow-up-reminders",
  "generated_at": "2026-05-17T09:00:00.000Z",
  "reminder_count": 1,
  "reminders": [],
  "notification": "1 follow-up reminder is due right now."
}
```

### `POST /api/n8n/weekly-report`

Builds a weekly report draft for the n8n digest workflow.

Example request:

```json
{
  "week_start": "2026-05-11",
  "week_end": "2026-05-17"
}
```

Current response shape:

```json
{
  "workflow": "weekly-report",
  "summary": "Weekly report draft for 2026-05-11 through 2026-05-17.",
  "metrics": {
    "jobs_discovered": 3,
    "jobs_shortlisted": 1,
    "jobs_applied": 0,
    "outreach_drafted": 1,
    "outreach_sent": 0,
    "responses_received": 0,
    "interviews": 0
  },
  "common_missing_skills": ["n8n"],
  "recommended_next_actions": ["Review the highest-priority shortlisted jobs."],
  "report_markdown": "# Weekly report...",
  "report_id": "44444444-4444-4444-8444-444444444444",
  "created_at": "2026-05-17T18:00:00.000Z",
  "report_url": "http://127.0.0.1:4000/api/reports/44444444-4444-4444-8444-444444444444/export",
  "email_subject": "Weekly report summary for 2026-05-11 to 2026-05-17",
  "email_body": "# Weekly report...",
  "notification": "Weekly report draft ready for n8n email delivery."
}
```

## Response Rules

- Return valid JSON.
- Use clear error messages for missing required inputs.
- Keep placeholder behavior obvious until the live backend is ready.
- The jobs routes should remain usable even if the UI falls back to seed data.
- Parse and fit-score responses should be structurally validated before being saved.
- Draft and report endpoints should remain human-review-first, not auto-send or auto-publish flows.
