# n8n Workflows

This folder documents the primary automation orchestrator.

If you want the cheapest route, start with the self-hosted guide in
[self-hosting.md](./self-hosting.md). It walks through running n8n locally in
Docker Desktop and wiring it to the JobOps API on your machine. It also points
to the ready-to-run `compose.yaml` and `.env.example` files in this folder.

The API now exposes n8n-specific webhook endpoints and expects `X-N8N-Webhook-Secret` when `N8N_WEBHOOK_SECRET` is configured.

Note on n8n webhook URLs: use the production URL shown by n8n for the active
workflow node. Newer n8n versions can namespace the webhook route with workflow
and node identifiers rather than exposing only `/webhook/job-intake`.

Recommended local baseline:

- Docker Desktop
- the JobOps API running on port `4000`
- `N8N_WEBHOOK_SECRET` set in `apps/api/.env` and in the n8n container
- `JOBOPS_API_BASE_URL=http://host.docker.internal:4000` inside the n8n container
- `WEBHOOK_URL=http://localhost:5678/` while you are testing locally

## API Targets

- `POST /api/n8n/job-intake`
- `POST /api/n8n/follow-up-reminders`
- `POST /api/n8n/weekly-report`

## Workflow Guide

### Job Intake And Enrichment

Use this workflow when a new job is discovered by n8n or when the dashboard needs to hand off a created job for analysis.

Request payload:

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

Workflow shape:

1. Receive the webhook payload.
2. Validate the secret.
3. POST the payload to `job-intake`.
4. Record the created job, parsed summary, and fit score in the CRM.
5. Emit a notification for human review rather than auto-sending anything.

### Daily Job Discovery

Use this workflow to discover candidate jobs on a schedule.

Workflow shape:

1. Pull candidates from the configured job source.
2. Deduplicate on `job_url`.
3. POST each new job into `job-intake`.
4. Notify the user that the job is ready for review.

### Follow-Up Reminder

Use this workflow on a schedule to surface overdue follow-ups.

Request payload:

```json
{
  "as_of": "2026-05-17T09:00:00.000Z"
}
```

Workflow shape:

1. Run on a daily schedule.
2. POST to `follow-up-reminders`.
3. Convert the returned reminder list into email, calendar, or task actions.

### Weekly Report

Use this workflow on a weekly schedule to build the report draft and send the digest.

Request payload:

```json
{
  "week_start": "2026-05-11",
  "week_end": "2026-05-17"
}
```

Workflow shape:

1. Run on a weekly schedule.
2. POST to `weekly-report`.
3. Send `email_subject`, `email_body`, and `report_markdown` through the digest node.

## Exports

The sample exports in this folder mirror the documented workflows:

- `exports/job-intake.workflow.json`
- `exports/follow-up-reminders.workflow.json`
- `exports/weekly-report.workflow.json`
