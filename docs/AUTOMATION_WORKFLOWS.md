# Automation Workflows

The workflow docs describe how JobOps Copilot automates the job-search process while keeping the user in control. The API exposes the main integration surfaces, and the n8n, Zapier, and Make.com flows are ready to import or build in their respective GUIs.

## Current API Hooks

The workflows build on the endpoints that already exist:

- `POST /api/jobs` for manual intake
- `POST /api/ai/parse-job` for structured parsing
- `POST /api/ai/score-fit` for fit scoring
- `POST /api/ai/draft-outreach` for outreach drafts
- `PATCH /api/outreach/:id` for manual outreach review states
- `POST /api/ai/generate-weekly-report` for weekly summaries
- `GET /api/reports` and `GET /api/reports/latest` for saved weekly report history
- `POST /api/n8n/job-intake` for webhook-driven job creation, parsing, and optional fit scoring
- `POST /api/n8n/discover` to sweep every saved-search user, pull new postings, and pre-rank them against each resume
- `POST /api/n8n/follow-up-reminders` for scheduled reminder queues
- `POST /api/n8n/weekly-report` for weekly digest drafts

## Scheduled discovery (built-in)

The Jobs feed's background auto-refresh ships in-repo as a GitHub Actions cron —
no external orchestrator required. `.github/workflows/discover.yml` runs every 6
hours (and on manual `workflow_dispatch`) and POSTs `/api/n8n/discover`, which
runs each user's saved searches, inserts new postings, and pre-ranks them
against their resume (the real LLM fit score then runs when a job is opened).

It's **inert until configured** — the job skips cleanly unless both are set in
the repo's Actions settings:

- Variable `NEXT_PUBLIC_API_BASE_URL` — the API origin (already set for the web
  deploy), e.g. `https://jobops-api.azurewebsites.net`.
- Secret `N8N_WEBHOOK_SECRET` — must match the API's `N8N_WEBHOOK_SECRET` env so
  the `X-N8N-Webhook-Secret` header is accepted.

Swap to an external scheduler (n8n, Make, Azure scheduled task) any time by
pointing it at the same endpoint with the same header; the workflow is just the
clock.

## n8n

n8n is the primary orchestrator in the long-term design.

The API expects `X-N8N-Webhook-Secret` when `N8N_WEBHOOK_SECRET` is configured.

For the cheapest beginner-friendly setup, see
[workflows/n8n/self-hosting.md](../workflows/n8n/self-hosting.md).

Implemented workflows:

- manual job intake processing
- daily job discovery
- AI processing and enrichment
- follow-up reminder creation
- weekly reporting

Current implementation notes:

- webhook calls can create a job, parse the description, and optionally score fit in one request
- follow-up reminders are returned as a sorted reminder list that n8n can turn into calendar or email actions
- weekly report calls now persist the saved report, export a markdown artifact, and return an email-ready subject, body, and markdown summary
- sample workflow exports live in `workflows/n8n/exports`

Recommended n8n pattern:

1. A trigger receives a job payload or scheduled discovery result.
2. The workflow upserts the job in the CRM through the API.
3. The workflow calls `parse-job` and then `score-fit` when a resume or profile context is available.
4. The workflow drafts outreach but stops before sending.
5. The workflow writes the result back to the CRM for auditability and lets the inbox controls mark the draft approved, sent, or skipped later.

## Zapier

Zapier is a lightweight companion sidecar — a 2-step Zap that watches a Google Sheet of tracked job applications and creates a Google Calendar follow-up reminder for each new row.

**Trigger:** Google Sheets — New Spreadsheet Row  
**Action:** Google Calendar — Create Detailed Event (summary `Follow up: <title> @ <company>`, date from `follow_up_date`, description with `notes` and `job_url`).

Setup: [workflows/zapier/setup.md](../workflows/zapier/setup.md) — includes creating the sheet from the CSV template, building the Zap step by step, field mapping, and testing.

Zapier is kept narrow and user-facing. It handles the human scheduling layer rather than the API-integrated intake path.

## Make.com

Make.com runs the API-integrated job-intake scenario: a custom webhook receives a job payload, POSTs it to `/api/n8n/job-intake` (with the `X-N8N-Webhook-Secret` header), and sends an email notification with the API's `fit_status` and `notification` response fields.

**Trigger:** Custom Webhook  
**Step 2:** HTTP POST → `https://jobops-api.azurewebsites.net/api/n8n/job-intake`  
**Step 3:** Email notification with fit status and notification text.

The scenario blueprint is at `workflows/make/exports/job-intake.blueprint.json` — import it directly into Make.com via **Create scenario → ⋮ → Import Blueprint**.

Setup: [workflows/make/setup.md](../workflows/make/setup.md) — includes blueprint import, credential wiring, webhook URL retrieval, and a curl test command.

## n8n vs Zapier vs Make — When to Reach for Each

| Dimension | n8n | Make.com | Zapier (free) |
|-----------|-----|----------|---------------|
| **Hosting** | Self-hosted (Docker) | Hosted SaaS | Hosted SaaS |
| **Orchestration depth** | Full — multi-step, branching, custom code, schedules | Visual multi-step, data transformation | 2-step only (free tier) |
| **Webhooks** | Free, built-in | Free (Custom Webhook module) | Premium app — not free |
| **HTTP / API calls** | Free, built-in | Free (HTTP module) | Premium app — not free |
| **Free tier ops** | Unlimited (self-hosted) | 1,000 ops/month | 100 tasks/month |
| **Role in JobOps** | Primary orchestrator for full pipeline | Full API-integrated intake scenario | Lightweight sidecar (sheet → calendar) |
| **Best when** | You want full control, self-hosting is fine, complex flows needed | You want a visual hosted scenario that calls the API without a server | You need a dead-simple human-scheduling hook and have no need for webhooks |

**Rule of thumb:**

- Reach for **n8n** when you want the full job-intake + fit-scoring + outreach-drafting pipeline running on your own infrastructure.
- Reach for **Make.com** when you want the same API-integrated scenario without running a server, and you can stay within 1,000 ops/month.
- Reach for **Zapier** when you need a quick, business-user-friendly sidecar (like a spreadsheet row firing a calendar reminder) and your monthly volume fits within 100 tasks.

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
- The Make.com blueprint and Zapier setup guide are ready to import/build. Screenshots will be added to `docs/design/phase7/` after the maintainer activates the flows.
