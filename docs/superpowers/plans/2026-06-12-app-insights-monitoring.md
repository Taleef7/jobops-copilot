# App Insights Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `jobops-insights` telemetry actionable: an email action group, two failure metric alerts, and a 4-tile portal dashboard, all from one provisioning script.

**Architecture:** Alerts + action group via the `az monitor` CLI (idempotent upsert); the portal dashboard via an ARM template deployed with `az deployment group create`. One local operator script, `az login` only, no secrets, never in CI.

**Tech Stack:** Bash, Azure CLI (`az monitor action-group`, `az monitor metrics alert`, `az deployment group`), ARM template (`Microsoft.Portal/dashboards`).

**Spec:** `docs/superpowers/specs/2026-06-12-app-insights-monitoring-design.md`

---

## File Structure

- **Create** `scripts/azure/dashboard-template.json` — ARM portal dashboard, 4 metric tiles bound to `jobops-insights`.
- **Create** `scripts/azure/provision-monitoring.sh` — action group + 2 alerts (CLI) + dashboard deploy (ARM).
- **Modify** `docs/AZURE_DEPLOYMENT.md` — add a "Monitoring & alerts" section.

---

## Task 1: Dashboard ARM template

**Files:**
- Create: `scripts/azure/dashboard-template.json`

- [ ] **Step 1: Create the template**

Create `scripts/azure/dashboard-template.json` with exactly:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "dashboardName": { "type": "string" },
    "componentId": { "type": "string" },
    "componentName": { "type": "string" },
    "location": { "type": "string", "defaultValue": "eastus" }
  },
  "resources": [
    {
      "type": "Microsoft.Portal/dashboards",
      "apiVersion": "2020-09-01-preview",
      "name": "[parameters('dashboardName')]",
      "location": "[parameters('location')]",
      "tags": { "hidden-title": "JobOps Monitoring" },
      "properties": {
        "lenses": [
          {
            "order": 0,
            "parts": [
              {
                "position": { "x": 0, "y": 0, "colSpan": 6, "rowSpan": 4 },
                "metadata": {
                  "inputs": [
                    { "name": "options", "isOptional": true },
                    { "name": "sharedTimeRange", "isOptional": true }
                  ],
                  "type": "Extension/HubsExtension/PartType/MonitorChartPart",
                  "settings": {
                    "content": {
                      "options": {
                        "chart": {
                          "metrics": [
                            {
                              "resourceMetadata": { "id": "[parameters('componentId')]" },
                              "name": "requests/count",
                              "aggregationType": 7,
                              "namespace": "microsoft.insights/components",
                              "metricVisualization": { "displayName": "Server requests" }
                            }
                          ],
                          "title": "Requests (24h)",
                          "titleKind": 1,
                          "visualization": { "chartType": 2 },
                          "timespan": { "relative": { "duration": 86400000 } }
                        }
                      }
                    }
                  }
                }
              },
              {
                "position": { "x": 6, "y": 0, "colSpan": 6, "rowSpan": 4 },
                "metadata": {
                  "inputs": [
                    { "name": "options", "isOptional": true },
                    { "name": "sharedTimeRange", "isOptional": true }
                  ],
                  "type": "Extension/HubsExtension/PartType/MonitorChartPart",
                  "settings": {
                    "content": {
                      "options": {
                        "chart": {
                          "metrics": [
                            {
                              "resourceMetadata": { "id": "[parameters('componentId')]" },
                              "name": "requests/failed",
                              "aggregationType": 7,
                              "namespace": "microsoft.insights/components",
                              "metricVisualization": { "displayName": "Failed requests" }
                            }
                          ],
                          "title": "Failed requests (24h)",
                          "titleKind": 1,
                          "visualization": { "chartType": 2 },
                          "timespan": { "relative": { "duration": 86400000 } }
                        }
                      }
                    }
                  }
                }
              },
              {
                "position": { "x": 0, "y": 4, "colSpan": 6, "rowSpan": 4 },
                "metadata": {
                  "inputs": [
                    { "name": "options", "isOptional": true },
                    { "name": "sharedTimeRange", "isOptional": true }
                  ],
                  "type": "Extension/HubsExtension/PartType/MonitorChartPart",
                  "settings": {
                    "content": {
                      "options": {
                        "chart": {
                          "metrics": [
                            {
                              "resourceMetadata": { "id": "[parameters('componentId')]" },
                              "name": "requests/duration",
                              "aggregationType": 4,
                              "namespace": "microsoft.insights/components",
                              "metricVisualization": { "displayName": "Server response time" }
                            }
                          ],
                          "title": "Avg server response time (24h)",
                          "titleKind": 1,
                          "visualization": { "chartType": 2 },
                          "timespan": { "relative": { "duration": 86400000 } }
                        }
                      }
                    }
                  }
                }
              },
              {
                "position": { "x": 6, "y": 4, "colSpan": 6, "rowSpan": 4 },
                "metadata": {
                  "inputs": [
                    { "name": "options", "isOptional": true },
                    { "name": "sharedTimeRange", "isOptional": true }
                  ],
                  "type": "Extension/HubsExtension/PartType/MonitorChartPart",
                  "settings": {
                    "content": {
                      "options": {
                        "chart": {
                          "metrics": [
                            {
                              "resourceMetadata": { "id": "[parameters('componentId')]" },
                              "name": "exceptions/server",
                              "aggregationType": 7,
                              "namespace": "microsoft.insights/components",
                              "metricVisualization": { "displayName": "Server exceptions" }
                            }
                          ],
                          "title": "Server exceptions (24h)",
                          "titleKind": 1,
                          "visualization": { "chartType": 2 },
                          "timespan": { "relative": { "duration": 86400000 } }
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        ],
        "metadata": { "model": {} }
      }
    }
  ]
}
```

- [ ] **Step 2: Validate it is well-formed JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('scripts/azure/dashboard-template.json','utf8')); console.log('dashboard template JSON ok')"
```
Expected: prints `dashboard template JSON ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/azure/dashboard-template.json
git commit -m "feat(ops): App Insights portal dashboard ARM template (4 tiles)"
```

---

## Task 2: `provision-monitoring.sh`

**Files:**
- Create: `scripts/azure/provision-monitoring.sh`

- [ ] **Step 1: Create the script**

Create `scripts/azure/provision-monitoring.sh` with exactly:

```bash
#!/usr/bin/env bash
# Provision Azure Monitor alerts + a portal dashboard for the JobOps App Insights
# component (jobops-insights): an email action group, two failure metric alerts,
# and a 4-tile dashboard.
#
# SECURITY: local operator tool — never run from CI. Authority is your own
# `az login` session. No secrets/IDs are committed; ALERT_EMAIL is read from your live
# `az` session (or the env var) at deploy time and never written to the repo.
#
# Usage:
#   scripts/azure/provision-monitoring.sh
#   ALERT_EMAIL=you@example.com scripts/azure/provision-monitoring.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

RESOURCE_GROUP="${RESOURCE_GROUP:-projects}"
LOCATION="${LOCATION:-eastus}"
COMPONENT="${COMPONENT:-jobops-insights}"
ACTION_GROUP="${ACTION_GROUP:-jobops-alerts}"
ACTION_SHORT="${ACTION_SHORT:-jobops}"
DASHBOARD_NAME="${DASHBOARD_NAME:-jobops-monitoring}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

# Fail early with a clear message if not logged in.
az account show -o none

# An action-group email receiver requires an address. Default to the signed-in
# account's email (its UPN); otherwise ask for ALERT_EMAIL.
if [[ -z "$ALERT_EMAIL" ]]; then
  ALERT_EMAIL="$(az account show --query user.name -o tsv 2>/dev/null || true)"
fi
if [[ -z "$ALERT_EMAIL" || "$ALERT_EMAIL" != *@*.* ]]; then
  echo "ERROR: an alert email is required. Re-run with ALERT_EMAIL=you@example.com" >&2
  exit 1
fi

echo "Resolving App Insights component '$COMPONENT' ..." >&2
COMPONENT_ID="$(az resource show -g "$RESOURCE_GROUP" -n "$COMPONENT" \
  --resource-type microsoft.insights/components --query id -o tsv)" \
  || { echo "ERROR: could not find App Insights component '$COMPONENT' in '$RESOURCE_GROUP'." >&2; exit 1; }

echo "Creating/updating action group '$ACTION_GROUP' (email: $ALERT_EMAIL) ..." >&2
az monitor action-group create -g "$RESOURCE_GROUP" -n "$ACTION_GROUP" \
  --short-name "$ACTION_SHORT" --action email jobops-email "$ALERT_EMAIL" -o none

AG_ID="$(az monitor action-group show -g "$RESOURCE_GROUP" -n "$ACTION_GROUP" --query id -o tsv)"

echo "Creating/updating metric alert 'jobops-failed-requests' ..." >&2
az monitor metrics alert create -n "jobops-failed-requests" -g "$RESOURCE_GROUP" \
  --scopes "$COMPONENT_ID" \
  --condition "total requests/failed >= 5" \
  --window-size 5m --evaluation-frequency 1m --severity 2 \
  --action "$AG_ID" \
  --description "JobOps: 5+ failed HTTP requests in 5 minutes." -o none

echo "Creating/updating metric alert 'jobops-server-exceptions' ..." >&2
az monitor metrics alert create -n "jobops-server-exceptions" -g "$RESOURCE_GROUP" \
  --scopes "$COMPONENT_ID" \
  --condition "total exceptions/server >= 5" \
  --window-size 5m --evaluation-frequency 1m --severity 2 \
  --action "$AG_ID" \
  --description "JobOps: 5+ server exceptions in 5 minutes." -o none

echo "Deploying dashboard '$DASHBOARD_NAME' ..." >&2
az deployment group create -g "$RESOURCE_GROUP" --name "jobops-dashboard-deploy" \
  --template-file "$(dirname "$0")/dashboard-template.json" \
  --parameters dashboardName="$DASHBOARD_NAME" componentId="$COMPONENT_ID" \
               componentName="$COMPONENT" location="$LOCATION" -o none

echo "Monitoring set up:" >&2
echo "  alerts -> $ALERT_EMAIL (action group '$ACTION_GROUP')" >&2
echo "  rules  : jobops-failed-requests, jobops-server-exceptions" >&2
echo "  dashboard: '$DASHBOARD_NAME' (Azure portal > Dashboard)" >&2
```

- [ ] **Step 2: Lint and make executable**

Run:
```bash
bash -n scripts/azure/provision-monitoring.sh && echo "syntax ok"
chmod +x scripts/azure/provision-monitoring.sh
command -v shellcheck >/dev/null && shellcheck scripts/azure/provision-monitoring.sh || echo "shellcheck not installed; skipped"
```
Expected: `syntax ok`, then no shellcheck errors or the skip message. Fix any shellcheck errors, keeping behavior identical.

- [ ] **Step 3: Commit (executable bit in git)**

```bash
git add --chmod=+x scripts/azure/provision-monitoring.sh
git commit -m "feat(ops): provision-monitoring.sh — action group + failure alerts + dashboard"
```

---

## Task 3: Docs

**Files:**
- Modify: `docs/AZURE_DEPLOYMENT.md`

- [ ] **Step 1: Append a "Monitoring & alerts" section**

Append the following to the END of `docs/AZURE_DEPLOYMENT.md` (read it first to find the
end). NOTE: the block contains a nested ```bash fence — keep it literal in the file:

````markdown

## Monitoring & alerts

Application Insights (`jobops-insights`) collects telemetry from web, API, and agent.
`scripts/azure/provision-monitoring.sh` makes that telemetry actionable — an email action
group, two failure alerts, and a portal dashboard. Local tool: acts only via your
`az login`, commits no secrets, never run from CI.

```bash
az login
scripts/azure/provision-monitoring.sh                              # emails your signed-in account
ALERT_EMAIL=you@example.com scripts/azure/provision-monitoring.sh   # send alerts to a specific inbox
```

**Alerts** (Azure Monitor metric alerts on the component, severity 2, emailed via the
`jobops-alerts` action group):

- `jobops-failed-requests` — 5+ failed HTTP requests in 5 minutes.
- `jobops-server-exceptions` — 5+ server exceptions in 5 minutes.

Both are failure-count based, so they stay quiet when the app is idle or `pause`d (no
traffic → no failures → no alert). There is deliberately **no latency alert** (the AI
endpoints make real LLM calls that are legitimately slow) and **no uptime ping** (it would
false-fire while intentionally paused). Response time is shown on the dashboard instead.

**Dashboard** `jobops-monitoring` (Azure portal → Dashboard) shows four tiles: requests,
failed requests, server response time, and server exceptions.

Re-running updates everything in place. Requires Monitoring Contributor (or Owner) on the
resource group. Cost is ~$0.20/mo (two alert rules; the action group and dashboard are
free).
````

- [ ] **Step 2: Verify the docs edit + security guard**

Run:
```bash
grep -q "## Monitoring & alerts" docs/AZURE_DEPLOYMENT.md && echo "docs ok"
grep -rl "provision-monitoring.sh" .github/workflows/ && echo "FAIL: workflow references the script" || echo "ok: no workflow references provision-monitoring.sh"
```
Expected: `docs ok`, then `ok: no workflow references provision-monitoring.sh`.

- [ ] **Step 3: Commit**

```bash
git add docs/AZURE_DEPLOYMENT.md
git commit -m "docs: monitoring & alerts section in AZURE_DEPLOYMENT"
```

---

## Task 4: Final verification + open the PR

**Files:** none.

- [ ] **Step 1: Re-run all local verification**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('scripts/azure/dashboard-template.json','utf8')); console.log('json ok')"
bash -n scripts/azure/provision-monitoring.sh && echo "syntax ok"
git ls-files -s scripts/azure/provision-monitoring.sh
grep -rl "provision-monitoring.sh" .github/workflows/ >/dev/null && echo "WORKFLOW LEAK" || echo "no-CI guard ok"
```
Expected: `json ok`, `syntax ok`, the script shows mode `100755`, and `no-CI guard ok`.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin app-insights-monitoring
```

- [ ] **Step 3: Open the PR (do not merge)**

```bash
gh pr create --title "feat(ops): App Insights monitoring — alerts + dashboard" --body "<summary: provision-monitoring.sh creates an email action group (recipient = signed-in az account by default, ALERT_EMAIL override, never committed), two failure metric alerts (jobops-failed-requests, jobops-server-exceptions; >=5 in 5 min, severity 2), and deploys a 4-tile portal dashboard (requests/failed/response-time/exceptions) from dashboard-template.json. Pause-compatible (failure-count alerts stay quiet with no traffic); no latency alert (LLM endpoints are legitimately slow) and no uptime ping (conflicts with pause). Security: local tool, az-login-only, no secrets, never in CI (guard-checked). Tests: dashboard JSON parse, bash -n.>"
```
Expected: PR URL printed. Do **not** merge — the maintainer merges. Live verification
(`provision-monitoring.sh`, then `az monitor metrics alert list -g projects -o table` and
the portal Dashboard) needs `az login`.

---

## Self-review notes

- **Spec coverage:** action group + email default (Task 2) ↔ spec "Recipient email";
  two failure alerts with thresholds/severity (Task 2) ↔ spec "Steps" 5; dashboard 4
  tiles (Task 1) ↔ spec "Dashboard"; docs incl. the no-latency/no-uptime rationale
  (Task 3) ↔ spec "Docs"/"Non-goals"; pause-compatibility is inherent (failure-count
  alerts) and stated in docs; security ↔ no-CI grep (Tasks 3–4) + header comment +
  runtime email; testing ↔ JSON parse + `bash -n` + no-CI grep.
- **No placeholders:** template, script, and docs content given in full.
- **Name consistency:** `jobops-insights`, `jobops-alerts`, `jobops-failed-requests`,
  `jobops-server-exceptions`, `jobops-monitoring`, `ALERT_EMAIL`, and the four metric
  names (`requests/count`, `requests/failed`, `requests/duration`, `exceptions/server`)
  match across template, script, and docs.
- **Email default** mirrors the merged budget fix (`az account show --query user.name`,
  validated, runtime-only) — consistent and avoids the empty-contact rejection.
