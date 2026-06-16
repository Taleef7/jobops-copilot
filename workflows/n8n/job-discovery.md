# n8n — Scheduled Job Discovery

Runs the per-user saved-search discovery sweep on a schedule, so each account's
saved searches keep pulling fresh postings without anyone clicking "Discover now".

## Import

1. In n8n, **Import from File** → `job-discovery.json`.
2. Set environment variables (or hardcode them in the HTTP Request node):
   - `JOBOPS_API_BASE_URL` — your API base, e.g. `https://jobops-api.azurewebsites.net`.
   - `N8N_WEBHOOK_SECRET` — must match the API's `N8N_WEBHOOK_SECRET`.
3. Activate the workflow.

## What it does

Every 24h the **Every 24h** schedule fires an HTTP `POST` to `/api/n8n/discover`
with the `X-N8N-Webhook-Secret` header. The API iterates every user with saved
searches, pulls fresh postings from the active source (Adzuna, falling back to
Remotive when Adzuna is unconfigured or rate-limited), dedups per user, and
inserts new jobs as `status='discovered'`. The response summarizes
`{ users, inserted, skipped }`.

The endpoint is mounted under `/api/n8n`, so it inherits the shared-API-key
exemption and is authenticated solely by the n8n webhook secret.
