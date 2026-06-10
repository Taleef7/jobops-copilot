# Optional Hardening + Phase 7 — Design Spec

Date: 2026-06-10
Status: approved (design), pending implementation plan

## Goal

Close the two remaining optional Phase 6 hardening items (Application Insights
monitoring, Key Vault for secrets) and then complete Phase 7 (Zapier + Make.com
companion automation flows) in full. Cost target: ≈ $0 on the Azure for Students
subscription and the free tiers of Zapier and Make.

This is the last functional work before the roadmap is fully complete; only the
deferred items become "done" here.

## Constraints & context

- **Subscription:** Azure for Students ($100 cap). Region policy `sys.regionrestriction`
  allows only `eastus, southcentralus, eastus2, swedencentral, mexicocentral` for
  Container Apps / related resources; use **`eastus`** for new resources (where ACR
  and the agent already live).
- **Auth friction:** `az` tokens expire fast on this sub (`invalid_grant`); user
  re-runs `! az login` when prompted.
- **PR workflow:** every change lands via a PR that the user reviews and merges.
  Never push to `main` and never self-merge.
- **Capability boundary:** Zapier and Make flows are built in their web GUIs on the
  user's accounts. This work delivers everything *around* the flows (endpoints,
  importable blueprints, click-by-click setup guides, payload/field mappings,
  comparison docs). The user assembles the live flows and captures screenshots.
- **Existing webhook surface:** `POST /api/n8n/job-intake|follow-up-reminders|weekly-report`
  authenticate via the `X-N8N-Webhook-Secret` header and scope all writes to a single
  dedicated automation account (`N8N_USER_ID`). Companion flows reuse this surface —
  no new endpoint and no per-user wrinkle.

## Workstream A — Application Insights

**Provision**
- One **workspace-based** Application Insights component (+ Log Analytics workspace)
  in `eastus`.
- Set a **1 GB/day ingestion cap** to guarantee near-zero cost.
- Capture provisioning as a repeatable script under `scripts/azure/`.

**Instrument all three services** (small code change + redeploy each):
- **API** (Express/Node, App Service): `applicationinsights` SDK initialized at the
  very top of `apps/api/src/server.ts`, reading `APPLICATIONINSIGHTS_CONNECTION_STRING`.
  Auto-collects HTTP requests, outbound dependencies (Postgres, agent calls), and
  exceptions. No-op when the env var is unset (local dev stays clean).
- **Web** (Next.js standalone, App Service): start the Node App Insights SDK from
  Next's official `instrumentation.ts` `register()` hook (server runtime only).
- **Agent** (FastAPI/Python, Container Apps): `azure-monitor-opentelemetry`
  `configure_azure_monitor()`, connection string via env. Rebuild the CPU-only image,
  push to ACR, `az containerapp update`.

**Config**
- Set `APPLICATIONINSIGHTS_CONNECTION_STRING` as an app setting on web + API App
  Services and as an env var / secret on the agent Container App.

**Acceptance**
- All three resources report telemetry; the application map shows web → API → agent
  → Postgres. `/api/health` still 200, web still 200. Daily cap visible in the portal.

## Workstream B — Key Vault (App Service secrets only)

**Provision**
- Key Vault in `eastus`, **RBAC** authorization mode. Script under `scripts/azure/`.

**Wire**
- Enable **system-assigned managed identity** on the web + API App Services.
- Grant each identity the **`Key Vault Secrets User`** role on the vault.
- Load high-value secrets into the vault:
  - API: `DATABASE_URL`, `CLERK_SECRET_KEY`
  - Web: `CLERK_SECRET_KEY`
- Replace those app settings with **Key Vault references**
  (`@Microsoft.KeyVault(SecretUri=…)`).

**Out of scope (intentional)**
- The agent Container App keeps its native (encrypted) secret store; LLM provider
  keys are not migrated.
- Public values (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) are not secrets and stay as-is.

**Acceptance**
- Both App Services boot with KV-referenced secrets; `/api/health` 200 (DB connected),
  web 200, auth works. No app **code** change required.

## Workstream C — Phase 7 (Zapier + Make)

### Make.com scenario (free tier: 1,000 ops/mo, custom webhook + HTTP modules free)
Webhook trigger → HTTP POST to `https://jobops-api.azurewebsites.net/api/n8n/job-intake`
with `X-N8N-Webhook-Secret` → format the parsed/scored result → email notification.

Deliverables:
- `workflows/make/exports/job-intake.blueprint.json` — importable blueprint template.
- `workflows/make/setup.md` — click-by-click setup + how to wire the secret.
- Payload examples and the expected API response shape.
- Rewritten `workflows/make/README.md`.

### Zapier Zap (free tier: 100 tasks/mo, 2-step only, no webhooks)
**New Google Sheets row → Create Google Calendar follow-up event.** Deliberately a
lightweight 2-step sidecar that stays inside the free envelope (Zapier free excludes
webhooks and multi-step Zaps; Google Sheets/Calendar/Gmail are standard free apps).

Deliverables:
- `workflows/zapier/setup.md` — click-by-click setup.
- `workflows/zapier/jobs-sheet-template.csv` — the Google Sheet column template.
- Field mapping (sheet columns → calendar event).
- Rewritten `workflows/zapier/README.md`.

### Docs
- Refresh `docs/AUTOMATION_WORKFLOWS.md` (move Zapier/Make from "planned" → built).
- Add an **n8n vs Zapier vs Make** comparison section to the README and/or
  AUTOMATION_WORKFLOWS.md (when to reach for each; what the free tiers allow).
- Flip Phase 7 to complete in `README.md`, `docs/ROADMAP.md`,
  `docs/IMPLEMENTATION_CHECKLIST.md`, `docs/IMPLEMENTATION_STATUS.md` once the live
  flows are assembled and screenshotted.

## Delivery plan

Three PRs, each opened for the user to review and merge (never self-merged):
1. **App Insights** — instrumentation in all three services + provisioning script/docs.
2. **Key Vault** — provisioning script + app-settings → KV reference swap + docs.
3. **Phase 7** — Make blueprint + Zapier template + setup guides + comparison docs.

Live `az` provisioning is performed during each PR's work and captured as repeatable
scripts under `scripts/azure/`.

## What requires the user

- `! az login` whenever the token expires.
- Building the Zapier Zap and Make scenario in the web GUIs from the setup guides.
- Capturing screenshots of the live flows for the docs.
- A Google account for Sheets/Calendar (already connected).

## Risks / things to verify during implementation

- Next.js `instrumentation.ts` App Insights init must run only in the Node runtime
  (guard against the edge runtime).
- Agent image rebuild must stay CPU-only torch (~1.6 GB) — don't pull CUDA wheels.
- Key Vault reference resolution requires the managed identity role assignment to
  propagate before the app restart; verify after a short delay.
- Confirm `eastus` is permitted for App Insights + Log Analytics + Key Vault under the
  region policy at provisioning time; fall back to another allowed region if blocked.
