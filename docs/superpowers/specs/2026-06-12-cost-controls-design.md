# Cost controls (budget guardrail + pause/resume) — design

## Problem

The deployment runs on an **Azure for Students** subscription with a hard **$100
credit cap**. Two gaps make it easy to burn credit unintentionally:

1. **No alarm.** Nothing warns when spending climbs — e.g. a forgotten warmed agent
   (`demo.sh warm`, ~$20–30/mo) or any anomaly silently eats credit.
2. **No off switch for the baseline.** Even fully idle, the always-on App Service B1
   plan (~$13/mo) and the Postgres server keep billing. There is no easy, safe way to
   put the stack to sleep during stretches when it is not used or demoed.

This delivers two small, cohesive cost controls: a **budget that emails alerts**, and a
**`pause`/`resume`** lifecycle script that safely stops/starts the chargeable baseline.

## Goals

- A monthly cost budget ($30) that emails alerts at 50/80/100% (actual) and 100%
  (forecast), created reproducibly from a committed template.
- A safe, reversible `pause` that stops the biggest clearly-stoppable baseline cost
  (Postgres) and ensures the agent is scaled to zero; a `resume` that brings it back;
  a read-only `status`.
- Honest docs about what each control does and does **not** stop.
- Safe to commit: no secrets, authority only via the operator's `az login`.

## Non-goals

- No automatic downgrade/deletion of the App Service plan (risky; F1 has real limits,
  delete is destructive). Documented as an optional manual step, not scripted.
- No change to app code, deploy workflows, or `demo.sh` (`warm`/`cool` stay as-is;
  `pause`/`resume` are the heavier baseline-level siblings).
- No spending *cap/enforcement* — Azure budgets only alert; they do not stop services.

## Deployment targets (real, env-overridable)

- Subscription: "Azure for Students" (budget is subscription-scoped).
- Resource group **`projects`**; Postgres Flexible Server **`jobops`**; Container App
  **`jobops-agent`**.

---

## Component A — Budget guardrail

### Files

- `scripts/azure/budget-template.json` — ARM template, **subscription deployment scope**,
  one `Microsoft.Consumption/budgets` resource.
- `scripts/azure/provision-budget.sh` — computes the start date and deploys the template.

### Template (`budget-template.json`)

Subscription-scoped ARM template (schema
`subscriptionDeploymentTemplate.json`). Parameters: `budgetName` (default
`jobops-monthly-30`), `amount` (default `30`), `startDate` (string, first of a month),
`contactEmails` (array, default `[]`). One resource:

- `type: Microsoft.Consumption/budgets`, `apiVersion: 2023-11-01`.
- `properties.category: Cost`, `amount: [amount]`, `timeGrain: Monthly`,
  `timePeriod: { startDate: [startDate], endDate: "2035-12-31" }`.
- `notifications` (4): `Actual_50`, `Actual_80`, `Actual_100`
  (`thresholdType: Actual`) and `Forecast_100` (`thresholdType: Forecasted`). Each:
  `enabled: true`, `operator: GreaterThanOrEqualTo`, `threshold: <pct>`,
  `contactRoles: ["Owner"]`, `contactEmails: [contactEmails]`.
- A subscription-scope budget **requires at least one `contactEmails`** entry
  (`contactRoles` alone is rejected by the `Microsoft.Consumption/budgets` schema). The
  script therefore defaults `contactEmails` to the signed-in operator's own email
  (read at runtime from `az account show --query user.name`, never committed), overridable
  via `BUDGET_EMAIL`; `contactRoles: ["Owner"]` is kept as an additional recipient.

### Script (`provision-budget.sh`)

- `set -euo pipefail`; `export MSYS_NO_PATHCONV=1`; `az account show -o none` preflight
  (matches `provision-appinsights.sh`).
- Env overrides: `BUDGET_NAME` (default `jobops-monthly-30`), `BUDGET_AMOUNT` (default
  `30`), `BUDGET_EMAIL` (recipient; defaults to the signed-in account's email from
  `az account show --query user.name`, validated to look like an email; the script
  errors asking for `BUDGET_EMAIL` if none can be derived), `DEPLOY_LOCATION` (default
  `eastus`, only deployment metadata).
- Compute `START_DATE` = first day of the current month (`date +%Y-%m-01`).
- Deploy:
  `az deployment sub create --name jobops-budget-deploy --location "$DEPLOY_LOCATION"
   --template-file "$(dirname "$0")/budget-template.json"
   --parameters budgetName="$BUDGET_NAME" amount="$BUDGET_AMOUNT" startDate="$START_DATE" contactEmails="$EMAILS_JSON"`
  where `EMAILS_JSON` is `["$BUDGET_EMAIL"]` when set, else `[]`.
- Idempotent: the budget is keyed by name; re-deploying updates it in place.
- On success, print the budget name, amount, thresholds, and where alerts go.

### Preconditions

- The deployer needs **Cost Management Contributor** or **Owner** on the subscription to
  create a budget. Documented; the script surfaces the permission error if missing.
- Azure for Students supports Cost Management budgets. If the Consumption API is ever
  rejected for the offer, the fallback is the portal (Cost Management → Budgets),
  noted in the docs.

---

## Component B — Lifecycle pause/resume

### Files

- `scripts/azure/lifecycle.sh` — `pause` | `resume` | `status` subcommands.
- `scripts/azure/lifecycle.test.sh` — unit tests for usage/dispatch (no Azure calls).

### Behavior

Config (env-overridable, real defaults): `RESOURCE_GROUP=projects`,
`AGENT_APP=jobops-agent`, `PG_RESOURCE_GROUP=projects`, `PG_SERVER=jobops`. Shared
`log`/`warn`/`die` helpers, `preflight` (require `az`; `az account show`), and a
`BASH_SOURCE` guard so tests can source pure helpers — same conventions as `demo.sh`.

- **`pause`**
  1. `az postgres flexible-server stop -g $PG_RESOURCE_GROUP -n $PG_SERVER` — tolerate
     only the already-stopped case; fail loudly on any other error (same
     tolerate-specific-error pattern as `demo.sh cool`).
  2. `az containerapp update -g $RESOURCE_GROUP -n $AGENT_APP --min-replicas 0` — ensure
     the agent is scaled to zero.
  3. Print what is now asleep (DB + agent) and the two caveats below.
- **`resume`**
  1. `az postgres flexible-server start -g $PG_RESOURCE_GROUP -n $PG_SERVER` — tolerate
     only the already-running case; fail loudly otherwise.
  2. Print that the DB is starting (takes a few minutes) and that the agent warms on
     demand (or via `demo.sh warm` before a demo).
- **`status`** (read-only)
  - Postgres state: `az postgres flexible-server show ... --query state -o tsv`.
  - Agent min replicas: `az containerapp show ... --query properties.template.scale.minReplicas -o tsv`.
  - Print a per-resource line; make no changes.

### Caveats (documented + printed by `pause`)

1. **While paused the live site's DB features fail** — pause only when the stack is not
   in use/being demoed; `resume` restores it.
2. **A stopped Flexible Server auto-restarts after 7 days** (Azure behavior) — re-run
   `pause` for longer stretches.
3. **The App Service B1 plan (~$13/mo) keeps billing** even when paused — stopping the
   *apps* does not reduce the *plan* charge. Fully zeroing it requires downgrading the
   plan tier to F1 or deleting it; both have real downsides, so they are a documented
   manual option, not scripted.

---

## Docs

Add a "Cost controls" section to `docs/AZURE_DEPLOYMENT.md`:
- The budget: what it alerts on, how to (re)create it (`provision-budget.sh`, optional
  `BUDGET_EMAIL`), and that it only alerts.
- `lifecycle.sh pause|resume|status`: what each does, the three caveats, and the
  optional manual App Service downgrade/delete for going fully to ~$0.
- A one-line pointer in `docs/DEMO.md` near the existing cost note linking to the budget
  + `cool`/`pause` distinction (cool = agent only; pause = whole baseline).

## Security

Same model as `demo.sh` (PR #33): local operator tools, no secrets or IDs committed
(only non-secret resource names), authority solely from the operator's `az login`
session, never invoked by CI. `BUDGET_EMAIL` is a deploy-time env var, never committed.

## Error handling

- Preflight fails clearly if `az` is missing or the session is unauthenticated.
- Budget deploy surfaces template/permission errors (e.g. missing Cost Management role).
- `pause`/`resume` tolerate only the expected idempotent state (already
  stopped/running) and `die` loudly on any other `az` error, so a partial failure is
  never reported as success.

## Testing / verification

- `node -e "JSON.parse(require('fs').readFileSync('scripts/azure/budget-template.json','utf8'))"`
  to confirm the template is valid JSON.
- `bash -n` on both scripts; `shellcheck` if available.
- `bash scripts/azure/lifecycle.test.sh` — usage/dispatch unit tests (no-arg → exit 2,
  bad subcommand → exit 1, `--help` → exit 0).
- `grep` guard: no workflow under `.github/workflows/` references either new script.
- Live (maintainer, needs `az login`): `provision-budget.sh` then `az consumption budget
  list`; `lifecycle.sh status` → `pause` → `status` (DB Stopped) → `resume` → `status`
  (DB Ready).

## Files (summary)

- **Create** `scripts/azure/budget-template.json`
- **Create** `scripts/azure/provision-budget.sh`
- **Create** `scripts/azure/lifecycle.sh`
- **Create** `scripts/azure/lifecycle.test.sh`
- **Modify** `docs/AZURE_DEPLOYMENT.md` (Cost controls section)
- **Modify** `docs/DEMO.md` (one-line cost pointer)
