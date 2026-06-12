# App Insights monitoring (alerts + dashboard) — design

## Problem

Application Insights (`jobops-insights`) already collects telemetry from web, API, and
agent (wired in earlier work), but nothing *consumes* it: there are no alerts and no
dashboard. A failing or crashing deployment goes unnoticed unless someone opens the
portal. This makes the wired-up telemetry actionable: email alerts when the app is
actually erroring, plus an at-a-glance dashboard.

## Goals

- Email alerts when the deployed app errors (failed requests / server exceptions).
- A portal dashboard with the key health tiles (requests, failures, response time,
  exceptions) for an at-a-glance view.
- Reproducible from a committed script + template, idempotent on re-run.
- Pause-compatible: alerts must not false-fire while the stack is intentionally paused.
- Safe to commit: no secrets; authority only via the operator's `az login`; never in CI.

## Non-goals

- **No latency/response-time alert.** The AI endpoints make real LLM calls that
  legitimately take 5–15+ s, so an avg-response-time alert would false-fire during normal
  use. Response time is kept as a dashboard *tile* (to see), not an alert (to page on).
- **No availability/uptime ping test.** It would email "down" whenever the stack is
  intentionally `pause`d, and classic ping tests are being deprecated by Microsoft.
- No change to app code or to how telemetry is emitted.

## Targets (real, env-overridable)

- Resource group **`projects`**, region **`eastus`**.
- App Insights component **`jobops-insights`** (all three services report to it).

## Architecture

One provisioning script plus one ARM template:

- `scripts/azure/provision-monitoring.sh` — creates the action group + the two metric
  alerts via the `az monitor` CLI (one command each), then deploys the dashboard ARM
  template. `set -euo pipefail`, `export MSYS_NO_PATHCONV=1`, `az account show` preflight
  (matches the other `provision-*.sh`).
- `scripts/azure/dashboard-template.json` — ARM `Microsoft.Portal/dashboards` resource
  (RG-scope deployment), four metric-chart tiles bound to `jobops-insights`.

Alerts use the CLI (simplest, idempotent upsert); the dashboard must be ARM (no clean
CLI for `Microsoft.Portal/dashboards`).

### Config block (env-overridable defaults)

```
RESOURCE_GROUP=projects
LOCATION=eastus
COMPONENT=jobops-insights
ACTION_GROUP=jobops-alerts
ACTION_SHORT=jobops          # action group short name (<= 12 chars)
DASHBOARD_NAME=jobops-monitoring
ALERT_EMAIL=<defaults to the signed-in az account email; see below>
```

### Recipient email (same pattern as the budget script)

An action-group email receiver requires an address. Default `ALERT_EMAIL` to the
signed-in account's email (`az account show --query user.name`, validated to look like an
email, read at runtime, never committed); if none can be derived, the script errors and
asks for `ALERT_EMAIL=you@example.com`.

### Steps (`provision-monitoring.sh`)

1. Preflight (`az account show`).
2. Resolve the component id:
   `COMPONENT_ID=$(az resource show -g $RESOURCE_GROUP -n $COMPONENT --resource-type microsoft.insights/components --query id -o tsv)`
   (avoids the application-insights CLI extension).
3. Create/Update the action group:
   `az monitor action-group create -g $RESOURCE_GROUP -n $ACTION_GROUP --short-name $ACTION_SHORT --action email jobops-email "$ALERT_EMAIL" -o none`
   (idempotent).
4. Get the action group id (`az monitor action-group show ... --query id -o tsv`).
5. Create/Update the two metric alerts (scope = `$COMPONENT_ID`, severity 2,
   eval frequency 1m, window 5m, wired to the action group id):
   - `jobops-failed-requests` — condition `total requests/failed >= 5`.
   - `jobops-server-exceptions` — condition `total exceptions/server >= 5`.
   `az monitor metrics alert create` upserts by name (re-running updates in place).
6. Deploy the dashboard:
   `az deployment group create -g $RESOURCE_GROUP --name jobops-dashboard-deploy --template-file dashboard-template.json --parameters dashboardName=$DASHBOARD_NAME componentId="$COMPONENT_ID" componentName=$COMPONENT location=$LOCATION -o none`.
7. Print where alerts go and the portal dashboard name.

### Dashboard (`dashboard-template.json`)

ARM template (`$schema` deploymentTemplate), parameters `dashboardName`,
`componentId`, `componentName`, `location`. One `Microsoft.Portal/dashboards` resource
with a lens containing four `Extension/HubsExtension/PartType/MonitorChartPart` tiles,
each bound to the `jobops-insights` component metric:

| Tile | Metric | Aggregation |
|------|--------|-------------|
| Requests | `requests/count` | total |
| Failed requests | `requests/failed` | total |
| Server response time | `requests/duration` | avg |
| Server exceptions | `exceptions/server` | total |

(Optionally a leading markdown tile titling the dashboard.) The exact tile JSON is
produced in the implementation plan; portal dashboard JSON is verbose, so correctness is
verified by JSON parse + `az deployment group validate` live.

## Why pause-compatible

Both alerts are failure-count based: with no traffic (e.g. while `lifecycle.sh pause` has
the stack asleep) there are zero failed requests and zero exceptions, so neither alert
fires. No special "disable during pause" handling is needed.

## Cost

Metric alert rules cost ~$0.10/rule/month (two rules ≈ $0.20/mo); the action group and
dashboard are free. Negligible against the $30 budget.

## Security

Same model as the other operator scripts: local tool, authority only via the operator's
`az login`, no secrets/IDs committed (only non-secret resource names), `ALERT_EMAIL`
read at runtime and never written, never referenced by any workflow.

## Error handling

- Preflight fails clearly if `az` is missing or unauthenticated.
- Component-id lookup failure (wrong name / not logged in) aborts with a clear message
  before creating anything.
- No derivable email and `ALERT_EMAIL` unset → abort asking for `ALERT_EMAIL`.
- `az` create/deploy failures surface the underlying error (e.g. missing Monitoring
  Contributor role to create alerts).

## Testing / verification

- `node -e "JSON.parse(... dashboard-template.json ...)"` — valid JSON.
- `bash -n scripts/azure/provision-monitoring.sh`; `shellcheck` if available.
- `grep` guard: no workflow under `.github/workflows/` references the script.
- Live (maintainer, needs `az login`): run the script, then
  `az monitor metrics alert list -g projects -o table`,
  `az monitor action-group list -g projects -o table`, and confirm the
  `jobops-monitoring` dashboard appears in the portal (Dashboard hub).

## Docs

Add a "Monitoring & alerts" section to `docs/AZURE_DEPLOYMENT.md`: what the two alerts
fire on, how to (re)run `provision-monitoring.sh` (and `ALERT_EMAIL` override), the
dashboard name, why there is no latency/availability alert, and the cost note.

## Files

- **Create** `scripts/azure/provision-monitoring.sh`
- **Create** `scripts/azure/dashboard-template.json`
- **Modify** `docs/AZURE_DEPLOYMENT.md` (Monitoring & alerts section)
