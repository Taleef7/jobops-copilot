# Make.com Companion Scenario

This directory contains a **ready-to-import** Make.com scenario that connects a custom webhook to the JobOps API and sends an email notification — the full job-intake loop in three modules.

## What the Scenario Does

```
Custom Webhook  →  HTTP POST /api/n8n/job-intake  →  Email notification
```

1. **Trigger (Custom Webhook)** — Make receives a JSON payload containing `company`, `title`, `description_text`, `job_url`, and `source`.
2. **API call (HTTP module)** — The scenario POSTs the payload to `https://jobops-api.azurewebsites.net/api/n8n/job-intake` with the `X-N8N-Webhook-Secret` header. The API creates the job record, parses the description, and runs fit scoring in a single request, returning `fit_status` and `notification`.
3. **Email notification (Email module)** — Make sends you a plain-text email whose **subject** carries the job title and company (e.g. `JobOps: AI Engineer @ Acme processed`) and whose **body** carries the fit status and notification string from the API response.

## Files

| File | Purpose |
|------|---------|
| `exports/job-intake.blueprint.json` | Importable Make scenario blueprint |
| `setup.md` | Click-by-click guide to import, configure, and test the scenario |

## Status

The blueprint is **ready to import and build** in the Make.com GUI. It is not a live running scenario — the maintainer imports it, wires credentials, and activates it following `setup.md`. Screenshots of the live scenario will be added to `docs/design/phase7/make-scenario.png` after activation.

## Free Tier Envelope

Make.com's free plan includes **1,000 operations per month**. Custom webhooks and HTTP modules are available at no cost. This three-module scenario consumes 3 operations per run (~333 job intakes/month on the free tier).

## Setup

See [setup.md](setup.md) for the full walkthrough: prerequisites, blueprint import, per-module credential fixes, webhook URL retrieval, and a curl test command.

## Why Make for This Scenario?

Make's visual canvas makes the webhook-to-API-to-email flow easy to understand and demo. Compared with n8n (self-hosted, full orchestration) and Zapier (lightweight 2-step sidecar), Make sits in the middle: hosted, free for moderate volumes, and capable of the full API-integrated scenario without a server to maintain. See `docs/AUTOMATION_WORKFLOWS.md` for the full three-tool comparison.
