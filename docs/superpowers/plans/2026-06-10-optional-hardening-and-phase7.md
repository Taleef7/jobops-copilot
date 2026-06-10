# Optional Hardening + Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Application Insights monitoring and Key Vault secret references to the live Azure stack, then ship Phase 7 (Zapier + Make.com companion automation flows) — all at ≈ $0.

**Architecture:** Three independent parts, each its own PR (opened for the user to review/merge — never self-merged). Part A instruments all three services (web, API, agent) with App Insights. Part B moves the App Services' high-value secrets to Key Vault references via managed identity. Part C delivers the Zapier/Make supporting artifacts (the user assembles the live flows). Live `az` provisioning is captured as repeatable scripts under `scripts/azure/`.

**Tech Stack:** Azure CLI, Application Insights (Node `applicationinsights` SDK, Python `azure-monitor-opentelemetry`), Azure Key Vault + managed identity, Make.com/Zapier free tiers, Express/Next.js/FastAPI.

**Spec:** `docs/superpowers/specs/2026-06-10-optional-hardening-and-phase7-design.md`

**Conventions for every part:**
- Branch from `main`, push, open a PR with `gh pr create`, then STOP. The user merges.
- Run `npm run check` (web+api) and, for agent changes, `cd services/agent && pytest && ruff check app tests` before committing.
- If `az` returns `invalid_grant`, ask the user to run `! az login` and continue.
- Resources go in resource group `projects`, region `eastus` (policy-allowed).

---

## PART A — Application Insights (PR 1)

**Branch:** `feat/app-insights`

### Task A1: Provision App Insights + Log Analytics with a daily cap

**Files:**
- Create: `scripts/azure/provision-appinsights.sh`

- [ ] **Step 1: Write the provisioning script**

Create `scripts/azure/provision-appinsights.sh`:

```bash
#!/usr/bin/env bash
# Provision workspace-based Application Insights for JobOps with a 1 GB/day cap.
# Idempotent-ish: re-running create on an existing resource is a no-op/update.
set -euo pipefail

RG=projects
LOCATION=eastus
WORKSPACE=jobops-logs
COMPONENT=jobops-insights

az extension add -n application-insights -y

az monitor log-analytics workspace create \
  --resource-group "$RG" --workspace-name "$WORKSPACE" --location "$LOCATION"

# 1 GB/day ingestion cap (guarantees ~$0). -1 would mean unlimited.
az monitor log-analytics workspace update \
  --resource-group "$RG" --workspace-name "$WORKSPACE" --quota 1

WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group "$RG" --workspace-name "$WORKSPACE" --query id -o tsv)

az monitor app-insights component create \
  --app "$COMPONENT" --resource-group "$RG" --location "$LOCATION" \
  --workspace "$WORKSPACE_ID" --application-type web

az monitor app-insights component show \
  --app "$COMPONENT" --resource-group "$RG" --query connectionString -o tsv
```

- [ ] **Step 2: Run the script and capture the connection string**

Run: `bash scripts/azure/provision-appinsights.sh`
Expected: ends by printing a connection string like
`InstrumentationKey=...;IngestionEndpoint=https://eastus-...`. Save it; later steps call it `<AI_CONNSTRING>`.
If `az` errors with `invalid_grant`, have the user run `! az login` and re-run.
If `--quota` is rejected, set the daily cap in the portal (Log Analytics workspace → Usage and estimated costs → Daily cap → 1 GB) and note it in the PR.

- [ ] **Step 3: Commit**

```bash
git add scripts/azure/provision-appinsights.sh
git commit -m "chore(azure): provision App Insights + Log Analytics (1 GB/day cap)"
```

### Task A2: Instrument the API (Express)

**Files:**
- Modify: `apps/api/package.json` (add dependency)
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/src/lib/telemetry.test.ts`
- Create: `apps/api/src/lib/telemetry.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install applicationinsights@^3 --workspace @jobops/api`
Expected: `applicationinsights` appears under `dependencies` in `apps/api/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/lib/telemetry.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTelemetry } from '@/lib/telemetry';

test('startTelemetry is a no-op and returns false when no connection string is set', () => {
  const prev = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  try {
    assert.equal(startTelemetry(), false);
  } finally {
    if (prev !== undefined) process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = prev;
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace @jobops/api`
Expected: FAIL — cannot find module `@/lib/telemetry`.

- [ ] **Step 4: Write the implementation**

Create `apps/api/src/lib/telemetry.ts`:

```ts
import * as appInsights from 'applicationinsights';

/**
 * Starts Application Insights when APPLICATIONINSIGHTS_CONNECTION_STRING is set.
 * No-op (returns false) in local dev / tests where the var is absent.
 */
export function startTelemetry(): boolean {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (!connectionString) {
    return false;
  }

  appInsights
    .setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectExceptions(true)
    .setAutoCollectPerformance(true, false)
    .setSendLiveMetrics(false)
    .setInternalLogging(false, false)
    .start();

  return true;
}
```

- [ ] **Step 5: Wire it into the server entry (before the app is built)**

Modify `apps/api/src/server.ts` so telemetry starts first:

```ts
import 'dotenv/config';
import { startTelemetry } from '@/lib/telemetry';

startTelemetry();

import { createApp } from '@/app';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`JobOps Copilot API listening on http://localhost:${port}`);
});
```

- [ ] **Step 6: Run tests + full check**

Run: `npm test --workspace @jobops/api`
Expected: PASS (including the new telemetry test).
Run: `npm run check`
Expected: lint + typecheck + build all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/lib/telemetry.ts apps/api/src/lib/telemetry.test.ts apps/api/src/server.ts
git commit -m "feat(api): Application Insights instrumentation (no-op without conn string)"
```

### Task A3: Instrument the web (Next.js)

**Files:**
- Modify: `apps/web/package.json` (add dependency)
- Create: `apps/web/src/instrumentation.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install applicationinsights@^3 --workspace @jobops/web`
Expected: `applicationinsights` appears under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Create the instrumentation hook**

Create `apps/web/src/instrumentation.ts`:

```ts
// Next.js calls register() once per server process at startup.
// Guard to the Node runtime so the App Insights SDK never loads on the edge.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  ) {
    const appInsights = await import('applicationinsights');
    appInsights
      .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
      .setAutoCollectConsole(false)
      .setSendLiveMetrics(false)
      .setInternalLogging(false, false)
      .start();
  }
}
```

- [ ] **Step 3: Verify build (instrumentation.ts is picked up automatically in Next 15+)**

Run: `npm run check`
Expected: web build succeeds; no error about `instrumentation`. (No `next.config` change is needed — the hook is stable in Next 16.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/instrumentation.ts
git commit -m "feat(web): Application Insights via Next instrumentation hook (node runtime only)"
```

### Task A4: Instrument the agent (FastAPI)

**Files:**
- Modify: `services/agent/requirements.txt`
- Modify: `services/agent/app/main.py`
- Create: `services/agent/tests/test_telemetry.py`

- [ ] **Step 1: Add the dependency**

Append to `services/agent/requirements.txt` (after the time-series block):

```
# Observability (App Insights via OpenTelemetry)
azure-monitor-opentelemetry>=1.6,<2
```

- [ ] **Step 2: Add a guarded telemetry init in the app entry**

In `services/agent/app/main.py`, add near the top (after the stdlib imports, before `app = FastAPI(...)` is created). First add:

```python
import os


def _configure_telemetry() -> bool:
    """Enable Azure Monitor (App Insights) when the conn string is present."""
    if not os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        return False
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor()
    return True


_configure_telemetry()
```

Place the `_configure_telemetry()` call immediately before the FastAPI app is instantiated so FastAPI/HTTP auto-instrumentation attaches.

- [ ] **Step 3: Write the test**

Create `services/agent/tests/test_telemetry.py`:

```python
from app.main import _configure_telemetry


def test_configure_telemetry_noop_without_conn_string(monkeypatch):
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    assert _configure_telemetry() is False
```

- [ ] **Step 4: Run the agent tests + lint**

Run: `cd services/agent && pytest tests/test_telemetry.py -v && ruff check app tests`
Expected: PASS + clean lint. (Install the new dep first if running locally: `pip install -r requirements.txt`.)

- [ ] **Step 5: Commit**

```bash
git add services/agent/requirements.txt services/agent/app/main.py services/agent/tests/test_telemetry.py
git commit -m "feat(agent): Azure Monitor (App Insights) telemetry, guarded by conn string"
```

### Task A5: Configure connection strings on all three live services

**Files:** none (live `az` config). Capture commands in the PR description.

- [ ] **Step 1: Set the app setting on web + API App Services**

```bash
az webapp config appsettings set -g projects -n jobops-api \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="<AI_CONNSTRING>"
az webapp config appsettings set -g projects -n jobops-web \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="<AI_CONNSTRING>"
```
Expected: JSON of updated settings (no error).

- [ ] **Step 2: Set the env var on the agent Container App**

```bash
az containerapp update -n jobops-agent -g projects \
  --set-env-vars APPLICATIONINSIGHTS_CONNECTION_STRING="<AI_CONNSTRING>"
```
Expected: a new revision is created.

- [ ] **Step 3: Deploy the three code changes**

- API: self-contained zipdeploy (see `jobops-azure-deploy` memory — fresh `dist` + `npm install --omit=dev` in a temp dir incl. `applicationinsights`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, POST to the SCM `zipdeploy`, `az webapp restart`).
- Web: pushes to `main` auto-deploy via `.github/workflows/deploy-web.yml`, so this lands when PR 1 merges. (Until then, web telemetry won't flow — acceptable.)
- Agent: rebuild the CPU-only image (`--index-url https://download.pytorch.org/whl/cpu` for torch), `docker push` to ACR `ca9ee6437892acr`, `az containerapp update -n jobops-agent --image ...:latest`.

- [ ] **Step 4: Verify telemetry end to end**

Run:
```bash
curl -s https://jobops-api.azurewebsites.net/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://jobops-web.azurewebsites.net
```
Then exercise an AI path (score a job in the live app). In the Azure portal, open `jobops-insights` → Application map; expect web → API → agent → Postgres nodes with request/dependency telemetry within a few minutes. Confirm the Log Analytics daily cap shows 1 GB.

- [ ] **Step 5: Open the PR (do not merge)**

```bash
git push -u origin feat/app-insights
gh pr create --title "feat: Application Insights monitoring (web, API, agent)" --body "<summary + the az commands run + portal screenshot of the application map>"
```
Then STOP and hand the PR to the user.

---

## PART B — Key Vault for App Service secrets (PR 2)

**Branch:** `feat/key-vault-secrets`

> Mostly live `az` work; no app code change. The provisioning script is the committed artifact.

### Task B1: Provision Key Vault + managed identity + role assignments

**Files:**
- Create: `scripts/azure/provision-keyvault.sh`

- [ ] **Step 1: Write the provisioning script**

Create `scripts/azure/provision-keyvault.sh`:

```bash
#!/usr/bin/env bash
# Provision Key Vault and grant the web+API App Service managed identities
# read access to secrets. RBAC auth mode (no access policies).
set -euo pipefail

RG=projects
LOCATION=eastus
VAULT=jobops-kv

az keyvault create \
  --name "$VAULT" --resource-group "$RG" --location "$LOCATION" \
  --enable-rbac-authorization true

KV_ID=$(az keyvault show --name "$VAULT" --resource-group "$RG" --query id -o tsv)

for APP in jobops-api jobops-web; do
  az webapp identity assign --resource-group "$RG" --name "$APP"
  PID=$(az webapp identity show --resource-group "$RG" --name "$APP" --query principalId -o tsv)
  az role assignment create \
    --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Secrets User" --scope "$KV_ID"
done

echo "Key Vault $VAULT ready. Vault URI:"
az keyvault show --name "$VAULT" --resource-group "$RG" --query properties.vaultUri -o tsv
```

- [ ] **Step 2: Run it**

Run: `bash scripts/azure/provision-keyvault.sh`
Expected: prints the vault URI `https://jobops-kv.vault.azure.net/`. Role assignments may take ~1–5 min to propagate.

- [ ] **Step 3: Commit**

```bash
git add scripts/azure/provision-keyvault.sh
git commit -m "chore(azure): provision Key Vault + App Service managed identities"
```

### Task B2: Load secrets and switch app settings to Key Vault references

**Files:** none (live `az`). Capture commands in the PR.

- [ ] **Step 1: Read the current secret values from existing app settings**

```bash
az webapp config appsettings list -g projects -n jobops-api \
  --query "[?name=='DATABASE_URL' || name=='CLERK_SECRET_KEY'].{name:name,value:value}" -o table
az webapp config appsettings list -g projects -n jobops-web \
  --query "[?name=='CLERK_SECRET_KEY'].{name:name,value:value}" -o table
```
Expected: the live values. Keep them only in shell variables; never commit them.

- [ ] **Step 2: Store secrets in the vault (KV names use dashes)**

```bash
az keyvault secret set --vault-name jobops-kv --name DATABASE-URL --value "<api DATABASE_URL>"
az keyvault secret set --vault-name jobops-kv --name CLERK-SECRET-KEY --value "<CLERK_SECRET_KEY>"
```
Expected: JSON for each secret (id ends with `/secrets/DATABASE-URL/<version>`).

- [ ] **Step 3: Point the app settings at Key Vault references**

```bash
az webapp config appsettings set -g projects -n jobops-api --settings \
  DATABASE_URL="@Microsoft.KeyVault(SecretUri=https://jobops-kv.vault.azure.net/secrets/DATABASE-URL/)" \
  CLERK_SECRET_KEY="@Microsoft.KeyVault(SecretUri=https://jobops-kv.vault.azure.net/secrets/CLERK-SECRET-KEY/)"

az webapp config appsettings set -g projects -n jobops-web --settings \
  CLERK_SECRET_KEY="@Microsoft.KeyVault(SecretUri=https://jobops-kv.vault.azure.net/secrets/CLERK-SECRET-KEY/)"
```
Expected: updated settings JSON.

- [ ] **Step 4: Restart and verify resolution**

```bash
az webapp restart -g projects -n jobops-api
az webapp restart -g projects -n jobops-web
sleep 30
curl -s https://jobops-api.azurewebsites.net/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://jobops-web.azurewebsites.net
```
Expected: API health `"mode":"postgres"` (DB reference resolved), web `200`. In the portal, the app settings show a green "Key Vault Reference" resolved status. If a reference shows an error, confirm the role assignment propagated (wait, then restart again).

- [ ] **Step 5: Sanity-check auth still works**

In a browser, sign in to the live app (Clerk) and load the dashboard — confirms `CLERK_SECRET_KEY` resolves at runtime for both apps.

- [ ] **Step 6: Open the PR (do not merge)**

```bash
git push -u origin feat/key-vault-secrets
gh pr create --title "chore(azure): move App Service secrets to Key Vault references" --body "<summary, the az commands (values redacted), and portal screenshot showing resolved KV references>"
```
Then STOP and hand the PR to the user.

---

## PART C — Phase 7: Zapier + Make companion flows (PR 3)

**Branch:** `feat/phase-7-zapier-make`

> Deliver everything around the flows; the user assembles the live Zaps/scenarios and adds screenshots.

### Task C1: Make.com — webhook → API → notification

**Files:**
- Create: `workflows/make/exports/job-intake.blueprint.json`
- Create: `workflows/make/setup.md`
- Rewrite: `workflows/make/README.md`

- [ ] **Step 1: Write the importable blueprint**

Create `workflows/make/exports/job-intake.blueprint.json` — a 3-module scenario (Custom webhook → HTTP POST to the API → Email). Use this structure (the user re-selects their email connection on import):

```json
{
  "name": "JobOps – Job Intake (webhook → API → notify)",
  "flow": [
    {
      "id": 1,
      "module": "gateway:CustomWebHook",
      "version": 1,
      "parameters": { "hook": "JobOps job intake", "maxResults": 1 },
      "mapper": {},
      "metadata": { "designer": { "x": 0, "y": 0 } }
    },
    {
      "id": 2,
      "module": "http:ActionSendData",
      "version": 3,
      "parameters": { "handleErrors": true, "useNewZLibDeCompress": true },
      "mapper": {
        "url": "https://jobops-api.azurewebsites.net/api/n8n/job-intake",
        "method": "post",
        "headers": [
          { "name": "Content-Type", "value": "application/json" },
          { "name": "X-N8N-Webhook-Secret", "value": "REPLACE_WITH_N8N_WEBHOOK_SECRET" }
        ],
        "bodyType": "raw",
        "contentType": "application/json",
        "data": "{\n  \"company\": \"{{1.company}}\",\n  \"title\": \"{{1.title}}\",\n  \"description_text\": \"{{1.description_text}}\",\n  \"job_url\": \"{{1.job_url}}\",\n  \"source\": \"make\"\n}"
      },
      "metadata": { "designer": { "x": 300, "y": 0 } }
    },
    {
      "id": 3,
      "module": "email:ActionSendEmail",
      "version": 6,
      "parameters": {},
      "mapper": {
        "to": ["REPLACE_WITH_YOUR_EMAIL"],
        "subject": "JobOps: {{1.title}} @ {{1.company}} processed",
        "contentType": "text",
        "text": "Job created and analyzed by JobOps.\n\nFit status: {{2.fit_status}}\nNotification: {{2.notification}}"
      },
      "metadata": { "designer": { "x": 600, "y": 0 } }
    }
  ],
  "metadata": {
    "version": 1,
    "scenario": { "roundtrips": 1, "maxErrors": 3, "autoCommit": true },
    "designer": { "orphans": [] }
  }
}
```

- [ ] **Step 2: Write the setup guide**

Create `workflows/make/setup.md` with these sections (write them out fully): prerequisites (free Make account, the API's `N8N_WEBHOOK_SECRET` value); import steps (Create scenario → ⋯ → Import Blueprint → upload `job-intake.blueprint.json`); per-module fixups (paste the secret into the HTTP header, reconnect the Email module to your account, set your recipient); how to grab the webhook URL; a `curl` to fire a test payload:

```bash
curl -X POST "<MAKE_WEBHOOK_URL>" \
  -H "Content-Type: application/json" \
  -d '{"company":"Acme","title":"AI Engineer","description_text":"Build LLM apps with Python and Azure.","job_url":"https://example.com/job/1"}'
```

Expected result: the scenario runs 3 modules, the API returns `fit_status`/`notification`, and you receive the email. Note where to drop the screenshot (`docs/design/phase7/make-scenario.png`).

- [ ] **Step 3: Rewrite the Make README**

Rewrite `workflows/make/README.md` to describe the built scenario (not "intended"): trigger, API call to `/api/n8n/job-intake`, notification; the free-tier envelope (1,000 ops/mo, webhooks free); and a pointer to `setup.md` + the blueprint.

- [ ] **Step 4: Commit**

```bash
git add workflows/make/
git commit -m "feat(workflows): Make.com job-intake blueprint + setup guide"
```

### Task C2: Zapier — Google Sheet row → Calendar reminder

**Files:**
- Create: `workflows/zapier/jobs-sheet-template.csv`
- Create: `workflows/zapier/setup.md`
- Rewrite: `workflows/zapier/README.md`

- [ ] **Step 1: Create the Google Sheet column template**

Create `workflows/zapier/jobs-sheet-template.csv`:

```csv
company,title,job_url,status,follow_up_date,notes
Acme,AI Engineer,https://example.com/job/1,shortlisted,2026-06-17,Referred by network
```

- [ ] **Step 2: Write the setup guide**

Create `workflows/zapier/setup.md` covering: why this is a deliberately lightweight 2-step Zap (Zapier free excludes webhooks + multi-step); create a Google Sheet from the CSV template; Zap trigger = **Google Sheets → New Spreadsheet Row**; Zap action = **Google Calendar → Create Detailed Event**; field mapping (Summary = `Follow up: {{title}} @ {{company}}`, Start = `follow_up_date`, Description = `notes` + `job_url`); test + turn on. Note the screenshot path `docs/design/phase7/zapier-zap.png`.

- [ ] **Step 3: Rewrite the Zapier README**

Rewrite `workflows/zapier/README.md` to describe the built 2-step sidecar, the free-tier constraints that shaped it, and a pointer to `setup.md` + the CSV template.

- [ ] **Step 4: Commit**

```bash
git add workflows/zapier/
git commit -m "feat(workflows): Zapier sheet-row → calendar reminder setup + template"
```

### Task C3: Comparison docs + automation overview refresh

**Files:**
- Modify: `docs/AUTOMATION_WORKFLOWS.md`
- Modify: `README.md`

- [ ] **Step 1: Update AUTOMATION_WORKFLOWS.md**

In `docs/AUTOMATION_WORKFLOWS.md`, change the Zapier and Make sections from "Planned use" to "Built" describing the shipped flows, and add an **"n8n vs Zapier vs Make"** comparison subsection: n8n = self-hosted, full orchestration, webhooks free; Make = hosted visual, webhooks+HTTP free (1,000 ops/mo); Zapier free = lightweight 2-step sidecar, no webhooks/multi-step. State when to reach for each.

- [ ] **Step 2: Add a short comparison pointer to the README**

In `README.md`, add a one-paragraph "Automation tiers" note linking to `docs/AUTOMATION_WORKFLOWS.md` and the two `workflows/*/setup.md` guides.

- [ ] **Step 3: Commit**

```bash
git add docs/AUTOMATION_WORKFLOWS.md README.md
git commit -m "docs: Zapier/Make built flows + n8n/Zapier/Make comparison"
```

### Task C4: User assembles live flows + screenshots, then flip status

**Files (after screenshots exist):**
- Create: `docs/design/phase7/make-scenario.png`, `docs/design/phase7/zapier-zap.png` (user-provided)
- Modify: `README.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_CHECKLIST.md`, `docs/IMPLEMENTATION_STATUS.md`

- [ ] **Step 1: Hand the setup guides to the user**

The user follows `workflows/make/setup.md` and `workflows/zapier/setup.md`, builds both flows on free accounts, fires the test payloads, and saves the two screenshots under `docs/design/phase7/`.

- [ ] **Step 2: Flip Phase 7 to complete (only after screenshots are committed)**

- `README.md` status table: Phase 7 `⏳ deferred` → `✅`.
- `docs/ROADMAP.md`: Status Summary Phase 7 → complete; Phase 7 section "Deferred" → "Complete" with the built flows.
- `docs/IMPLEMENTATION_CHECKLIST.md`: check off the three Phase 7 items.
- `docs/IMPLEMENTATION_STATUS.md`: remove Phase 7 from "What Is Still Pending"; add a verified milestone line.

- [ ] **Step 3: Commit**

```bash
git add docs/design/phase7/ README.md docs/ROADMAP.md docs/IMPLEMENTATION_CHECKLIST.md docs/IMPLEMENTATION_STATUS.md
git commit -m "docs: mark Phase 7 complete (Zapier + Make flows live, screenshots)"
```

- [ ] **Step 4: Open the PR (do not merge)**

```bash
git push -u origin feat/phase-7-zapier-make
gh pr create --title "feat: Phase 7 — Zapier + Make companion automation flows" --body "<summary, the two flow descriptions, screenshots, comparison>"
```
Then STOP and hand the PR to the user.

---

## Self-review notes

- **Spec coverage:** Part A ↔ Workstream A (provision + 3 services + config + verify); Part B ↔ Workstream B (vault + identity + secrets + references, App Service only, no agent migration); Part C ↔ Workstream C (Make blueprint, Zapier 2-step, comparison docs, status flips). Cost cap (A1 daily quota), region `eastus`, and the PR-no-merge rule are all encoded.
- **No placeholders:** every code/command step has concrete content. `<AI_CONNSTRING>` and secret values are runtime-resolved by design and intentionally not hardcoded.
- **Type consistency:** `startTelemetry()` (api) and `_configure_telemetry()` (agent) names match between their implementation and test tasks; KV secret names use dashes consistently (`DATABASE-URL`, `CLERK-SECRET-KEY`) in both set and reference steps.
- **Known verify-at-runtime items:** `--quota` flag for the daily cap (portal fallback noted); role-assignment propagation delay before KV references resolve; Make blueprint module versions may need minor adjustment on import (the user reconnects the email module regardless).
