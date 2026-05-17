# Automation Workflows

The workflow docs describe how JobOps Copilot should automate the job-search process while keeping the user in control. The API already exposes the main integration surfaces, but the orchestrated n8n, Zapier, and Make.com flows are still documentation-first.

## Current API Hooks

The workflows should build on the endpoints that already exist:

- `POST /api/jobs` for manual intake
- `POST /api/ai/parse-job` for structured parsing
- `POST /api/ai/score-fit` for fit scoring
- `POST /api/ai/draft-outreach` for outreach drafts
- `PATCH /api/outreach/:id` for manual outreach review states
- `POST /api/ai/generate-weekly-report` for weekly summaries
- `POST /api/n8n/job-intake` for webhook-driven job creation, parsing, and optional fit scoring
- `POST /api/n8n/follow-up-reminders` for scheduled reminder queues
- `POST /api/n8n/weekly-report` for weekly digest drafts

## n8n

n8n is the primary orchestrator in the long-term design.

The API expects `X-N8N-Webhook-Secret` when `N8N_WEBHOOK_SECRET` is configured.

For the cheapest beginner-friendly setup, see
[workflows/n8n/self-hosting.md](../workflows/n8n/self-hosting.md).

Planned workflows:

- manual job intake processing
- daily job discovery
- AI processing and enrichment
- follow-up reminder creation
- weekly reporting

Current implementation notes:

- webhook calls can create a job, parse the description, and optionally score fit in one request
- follow-up reminders are returned as a sorted reminder list that n8n can turn into calendar or email actions
- weekly report calls return an email-ready subject, body, and markdown summary
- sample workflow exports live in `workflows/n8n/exports`

Recommended n8n pattern:

1. A trigger receives a job payload or scheduled discovery result.
2. The workflow upserts the job in the CRM through the API.
3. The workflow calls `parse-job` and then `score-fit` when a resume or profile context is available.
4. The workflow drafts outreach but stops before sending.
5. The workflow writes the result back to the CRM for auditability and lets the inbox controls mark the draft approved, sent, or skipped later.

## Zapier

Zapier is the lightweight companion automation layer.

Planned use:

- create calendar reminders
- create Gmail drafts
- send a self-notification after a job is added
- surface quick "needs review" tasks

Zapier should stay narrow and user-facing. It is best for simple sidecar automations rather than the main CRM orchestration path.

## Make.com

Make.com demonstrates a visual automation scenario.

Planned use:

- receive a new job payload via webhook
- call the API for parsing and scoring
- store or update the CRM record
- send a formatted summary message to the user

Make is useful as a visual proof point for the portfolio, especially if a workflow needs to be easy to explain in screenshots or a case study.

## Shared Automation Rules

- Never auto-send outreach without approval.
- Keep every action auditable in the CRM.
- Treat automations as workflow infrastructure, not spam tooling.
- Keep webhook requests authenticated. The repo already includes `N8N_WEBHOOK_SECRET` in `.env.example`, and the API workspace should carry the same value in `apps/api/.env` so the webhook endpoints can verify callers.
- Prefer drafts, reminders, and summaries over direct side effects.

## Progress Notes

- The API already supports the key automation primitives.
- Outreach drafts are stored as drafts, not sent automatically, and the inbox can move them through manual review states.
- Gmail draft creation is optional and only runs when the feature flag plus OAuth credentials are present.
- Weekly report generation currently returns a draft report from seeded analytics data.
- Workflow execution will become more useful once n8n and the companion tools are connected to the live API.
