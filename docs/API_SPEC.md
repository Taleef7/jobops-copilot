# API Spec

The API exposes jobs and AI endpoints backed by either the local file store or PostgreSQL, depending on whether `DATABASE_URL` is configured. In the default local setup the file store keeps the CRM state persistent between API restarts. When `DATABASE_URL` is present, the API switches to the Postgres-backed store and reports that in `/api/health`.

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

## AI

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
  "contact_role": "Optional Role"
}
```

Current response shape:

```json
{
  "subject": "Interest in the role and a quick introduction",
  "draft_text": "Hi Optional Name, ...",
  "safety_notes": "Draft only. Human review is required before sending.",
  "outreach_id": "uuid",
  "job_id": "uuid"
}
```

If `job_id` is supplied and matches an existing job, the draft is also stored in the `outreach` table with `status: "drafted"`. If the job ID does not resolve, the endpoint still returns the generated draft but does not persist it.

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
  "report_markdown": "# Weekly report..."
}
```

This endpoint is still draft-oriented. Persisted weekly report storage and dashboards are future work.

## Response Rules

- Return valid JSON.
- Use clear error messages for missing required inputs.
- Keep placeholder behavior obvious until the live backend is ready.
- The jobs routes should remain usable even if the UI falls back to seed data.
- Parse and fit-score responses should be structurally validated before being saved.
- Draft and report endpoints should remain human-review-first, not auto-send or auto-publish flows.
