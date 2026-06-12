# Cost Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subscription cost budget (email alerts) and a `lifecycle.sh pause/resume/status` script so the JobOps deployment's spend is both alarmed and pausable.

**Architecture:** Two local `az`-driven operator tools matching the existing `scripts/azure/*.sh` pattern: an ARM budget template deployed via `az deployment sub create`, and a bash lifecycle script that stops/starts Postgres + scales the agent. Pure dispatch logic is unit-tested; `az` side effects are verified live. No secrets; authority is the operator's `az login` only; never invoked by CI.

**Tech Stack:** Bash, Azure CLI (`az deployment sub`, `az postgres flexible-server`, `az containerapp`), ARM template (`Microsoft.Consumption/budgets`).

**Spec:** `docs/superpowers/specs/2026-06-12-cost-controls-design.md`

---

## File Structure

- **Create** `scripts/azure/budget-template.json` — ARM template (subscription scope), one budget resource with 4 notifications.
- **Create** `scripts/azure/provision-budget.sh` — deploys the template (start-date + params).
- **Create** `scripts/azure/lifecycle.sh` — `pause`/`resume`/`status` for the baseline.
- **Create** `scripts/azure/lifecycle.test.sh` — dispatch/usage unit tests (no Azure calls).
- **Modify** `docs/AZURE_DEPLOYMENT.md` — add a "Cost controls" section.
- **Modify** `docs/DEMO.md` — one-line pointer from the cost note to `lifecycle.sh pause`.

---

## Task 1: Budget template + provisioning script

**Files:**
- Create: `scripts/azure/budget-template.json`
- Create: `scripts/azure/provision-budget.sh`

- [ ] **Step 1: Create the ARM template**

Create `scripts/azure/budget-template.json` with exactly:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "budgetName": { "type": "string", "defaultValue": "jobops-monthly-30" },
    "amount": { "type": "int", "defaultValue": 30 },
    "startDate": { "type": "string" },
    "contactEmails": { "type": "array", "defaultValue": [] }
  },
  "resources": [
    {
      "type": "Microsoft.Consumption/budgets",
      "apiVersion": "2023-11-01",
      "name": "[parameters('budgetName')]",
      "properties": {
        "category": "Cost",
        "amount": "[parameters('amount')]",
        "timeGrain": "Monthly",
        "timePeriod": {
          "startDate": "[parameters('startDate')]",
          "endDate": "2035-12-31"
        },
        "notifications": {
          "Actual_50": {
            "enabled": true,
            "operator": "GreaterThanOrEqualTo",
            "threshold": 50,
            "contactEmails": "[parameters('contactEmails')]",
            "contactRoles": [ "Owner" ],
            "thresholdType": "Actual"
          },
          "Actual_80": {
            "enabled": true,
            "operator": "GreaterThanOrEqualTo",
            "threshold": 80,
            "contactEmails": "[parameters('contactEmails')]",
            "contactRoles": [ "Owner" ],
            "thresholdType": "Actual"
          },
          "Actual_100": {
            "enabled": true,
            "operator": "GreaterThanOrEqualTo",
            "threshold": 100,
            "contactEmails": "[parameters('contactEmails')]",
            "contactRoles": [ "Owner" ],
            "thresholdType": "Actual"
          },
          "Forecast_100": {
            "enabled": true,
            "operator": "GreaterThanOrEqualTo",
            "threshold": 100,
            "contactEmails": "[parameters('contactEmails')]",
            "contactRoles": [ "Owner" ],
            "thresholdType": "Forecasted"
          }
        }
      }
    }
  ]
}
```

- [ ] **Step 2: Validate the template is well-formed JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('scripts/azure/budget-template.json','utf8')); console.log('budget template JSON ok')"
```
Expected: prints `budget template JSON ok`.

- [ ] **Step 3: Create the provisioning script**

Create `scripts/azure/provision-budget.sh` with exactly:

```bash
#!/usr/bin/env bash
# Provision a monthly Cost Management budget for the JobOps subscription, with
# alerts at 50/80/100% (actual) and 100% (forecast) to the Owner role (and an
# optional explicit email).
#
# SECURITY: local operator tool — never run from CI. Authority is your own
# `az login` session. No secrets/IDs are committed; BUDGET_EMAIL (if used) is a
# deploy-time env var and is never written to the repo.
#
# Usage:
#   scripts/azure/provision-budget.sh
#   BUDGET_EMAIL=you@example.com BUDGET_AMOUNT=30 scripts/azure/provision-budget.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

BUDGET_NAME="${BUDGET_NAME:-jobops-monthly-30}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-30}"
DEPLOY_LOCATION="${DEPLOY_LOCATION:-eastus}"
BUDGET_EMAIL="${BUDGET_EMAIL:-}"

# Fail early with a clear message if not logged in.
az account show -o none

START_DATE="$(date +%Y-%m-01)"

if [[ -n "$BUDGET_EMAIL" ]]; then
  EMAILS_JSON="[\"${BUDGET_EMAIL}\"]"
else
  EMAILS_JSON="[]"
fi

TEMPLATE="$(dirname "$0")/budget-template.json"

echo "Deploying budget '$BUDGET_NAME' (\$$BUDGET_AMOUNT/mo, start $START_DATE) ..." >&2
az deployment sub create \
  --name "jobops-budget-deploy" \
  --location "$DEPLOY_LOCATION" \
  --template-file "$TEMPLATE" \
  --parameters \
      budgetName="$BUDGET_NAME" \
      amount="$BUDGET_AMOUNT" \
      startDate="$START_DATE" \
      contactEmails="$EMAILS_JSON" \
  -o none

echo "Budget '$BUDGET_NAME' set: alerts at 50/80/100% (actual) + 100% (forecast)." >&2
if [[ -n "$BUDGET_EMAIL" ]]; then
  echo "Alerts go to: $BUDGET_EMAIL and the subscription Owner role." >&2
else
  echo "Alerts go to the subscription Owner role (set BUDGET_EMAIL=you@example.com to also email a specific inbox)." >&2
fi
```

- [ ] **Step 4: Lint and make executable**

Run:
```bash
bash -n scripts/azure/provision-budget.sh && echo "syntax ok"
chmod +x scripts/azure/provision-budget.sh
command -v shellcheck >/dev/null && shellcheck scripts/azure/provision-budget.sh || echo "shellcheck not installed; skipped"
```
Expected: `syntax ok`, then no shellcheck errors or the skip message.

- [ ] **Step 5: Commit (set the executable bit in git explicitly)**

```bash
git add scripts/azure/budget-template.json
git add --chmod=+x scripts/azure/provision-budget.sh
git commit -m "feat(ops): subscription cost budget with email alerts (provision-budget.sh)"
```

---

## Task 2: `lifecycle.sh` pause/resume/status + unit tests (TDD)

**Files:**
- Create: `scripts/azure/lifecycle.test.sh`
- Create: `scripts/azure/lifecycle.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/azure/lifecycle.test.sh` with exactly:

```bash
#!/usr/bin/env bash
# Unit tests for lifecycle.sh dispatch/usage (no Azure calls).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source without running main() — lifecycle.sh guards main behind a BASH_SOURCE check.
# shellcheck source=/dev/null
source "$DIR/lifecycle.sh"
set +e  # lifecycle.sh enables -e; disable it so assertions can observe failures.

fail=0
bash "$DIR/lifecycle.sh" >/dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok: no-arg exits 2" || { echo "FAIL: no-arg exit code"; fail=1; }
bash "$DIR/lifecycle.sh" bogus >/dev/null 2>&1; [ "$?" -eq 1 ] && echo "ok: bad subcommand exits 1" || { echo "FAIL: bad subcommand exit code"; fail=1; }
bash "$DIR/lifecycle.sh" --help >/dev/null 2>&1; [ "$?" -eq 0 ] && echo "ok: --help exits 0" || { echo "FAIL: --help exit code"; fail=1; }

help_out="$(bash "$DIR/lifecycle.sh" --help 2>&1)"
for sub in pause resume status; do
  printf '%s' "$help_out" | grep -q "$sub" && echo "ok: help mentions $sub" || { echo "FAIL: help missing $sub"; fail=1; }
done

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; exit 1; fi
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `bash scripts/azure/lifecycle.test.sh`
Expected: FAIL — `source` errors because `scripts/azure/lifecycle.sh` does not exist yet.

- [ ] **Step 3: Create `scripts/azure/lifecycle.sh`**

Create `scripts/azure/lifecycle.sh` with exactly:

```bash
#!/usr/bin/env bash
#
# lifecycle.sh — pause/resume the chargeable JobOps baseline (Postgres + agent).
#
# SECURITY / SAFETY
#   - LOCAL OPERATOR TOOL. Never invoke from CI or automation that holds stored
#     cloud credentials. All authority comes from your own `az login` session.
#   - No secrets/IDs — only non-secret resource names (overridable via env vars).
#
# Usage:
#   scripts/azure/lifecycle.sh pause    # stop Postgres + scale agent to zero
#   scripts/azure/lifecycle.sh resume   # start Postgres back up
#   scripts/azure/lifecycle.sh status   # read-only: DB state + agent min-replicas
#
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-projects}"
AGENT_APP="${AGENT_APP:-jobops-agent}"
PG_RESOURCE_GROUP="${PG_RESOURCE_GROUP:-projects}"
PG_SERVER="${PG_SERVER:-jobops}"

log()  { printf '\033[1;34m[lifecycle]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[lifecycle]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[lifecycle]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: lifecycle.sh <pause|resume|status>

  pause    Stop the Postgres server and scale the agent to min-replicas=0.
  resume   Start the Postgres server back up.
  status   Read-only: show the Postgres state and the agent's min-replicas.

Resource names default to the live deployment and can be overridden via env vars:
RESOURCE_GROUP, AGENT_APP, PG_RESOURCE_GROUP, PG_SERVER.
EOF
}

require_tools() {
  command -v az >/dev/null 2>&1 || die "Azure CLI 'az' not found. Install: https://aka.ms/azcli"
}

require_login() {
  az account show >/dev/null 2>&1 || die "Not logged in to Azure. Run: az login"
}

preflight() { require_tools; require_login; }

# Run an az command, tolerating ONLY errors whose message matches $2 (regex);
# die loudly on any other failure so a partial failure is never reported as success.
#   $1 = human label, $2 = tolerate-regex, $3.. = command to run
run_tolerating() {
  local label="$1" tolerate="$2"; shift 2
  local err
  if err="$("$@" 2>&1)"; then
    return 0
  elif printf '%s' "$err" | grep -qiE "$tolerate"; then
    warn "$label: already in the desired state (tolerated)."
    return 0
  else
    die "$label failed: $err"
  fi
}

cmd_pause() {
  preflight
  log "stopping Postgres server '$PG_SERVER' ..."
  run_tolerating "stop Postgres" 'already.*stopp|not.*running|current state.*stopp' \
    az postgres flexible-server stop -g "$PG_RESOURCE_GROUP" -n "$PG_SERVER"
  log "scaling agent '$AGENT_APP' to min-replicas=0 ..."
  az containerapp update -g "$RESOURCE_GROUP" -n "$AGENT_APP" --min-replicas 0 -o none \
    || die "failed to scale down the agent."
  log "PAUSED: Postgres stopped, agent scaled to zero."
  warn "While paused, the live site's DB features will not work — run 'resume' before using/demoing it."
  warn "Azure auto-restarts a stopped Flexible Server after ~7 days; re-run 'pause' for longer stretches."
  warn "The App Service B1 plan (~\$13/mo) keeps billing while paused — see docs/AZURE_DEPLOYMENT.md to go fully to ~\$0."
}

cmd_resume() {
  preflight
  log "starting Postgres server '$PG_SERVER' ..."
  run_tolerating "start Postgres" 'already.*runn|not.*stopp|current state.*ready' \
    az postgres flexible-server start -g "$PG_RESOURCE_GROUP" -n "$PG_SERVER"
  log "RESUMED: Postgres is starting (it can take a few minutes to accept connections)."
  log "The agent stays scale-to-zero; it warms on first request, or run 'demo.sh warm' before a demo."
}

cmd_status() {
  preflight
  local pg_state min_replicas
  pg_state="$(az postgres flexible-server show -g "$PG_RESOURCE_GROUP" -n "$PG_SERVER" --query state -o tsv 2>/dev/null)" \
    || pg_state="(unknown — check name/login)"
  min_replicas="$(az containerapp show -g "$RESOURCE_GROUP" -n "$AGENT_APP" --query properties.template.scale.minReplicas -o tsv 2>/dev/null)" \
    || min_replicas="(unknown — check name/login)"
  log "Postgres '$PG_SERVER' state   : ${pg_state}"
  log "agent '$AGENT_APP' minReplicas : ${min_replicas:-0}"
}

main() {
  case "${1:-}" in
    pause)  cmd_pause ;;
    resume) cmd_resume ;;
    status) cmd_status ;;
    -h|--help|help) usage ;;
    "")     usage; exit 2 ;;
    *)      usage; die "unknown subcommand: ${1}" ;;
  esac
}

# Only run main when executed directly, so the test can source pure helpers.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
```

- [ ] **Step 4: Make both executable**

Run: `chmod +x scripts/azure/lifecycle.sh scripts/azure/lifecycle.test.sh`

- [ ] **Step 5: Run the test, confirm it PASSES**

Run: `bash scripts/azure/lifecycle.test.sh`
Expected: every line `ok: ...` and final `ALL PASS`. If anything fails, fix the script (not the test) and re-run.

- [ ] **Step 6: Lint**

Run:
```bash
bash -n scripts/azure/lifecycle.sh && echo "syntax ok"
command -v shellcheck >/dev/null && shellcheck scripts/azure/lifecycle.sh || echo "shellcheck not installed; skipped"
```
Expected: `syntax ok`, then no shellcheck errors or the skip message. If shellcheck flags issues, fix and re-run the unit test.

- [ ] **Step 7: Commit (executable bit in git)**

```bash
git add --chmod=+x scripts/azure/lifecycle.sh scripts/azure/lifecycle.test.sh
git commit -m "feat(ops): lifecycle.sh pause/resume/status for the chargeable baseline"
```

---

## Task 3: Docs

**Files:**
- Modify: `docs/AZURE_DEPLOYMENT.md`
- Modify: `docs/DEMO.md`

- [ ] **Step 1: Append a "Cost controls" section to `docs/AZURE_DEPLOYMENT.md`**

Append the following to the END of `docs/AZURE_DEPLOYMENT.md` (after the last line):

````markdown

## Cost controls

The deployment runs on an Azure for Students subscription with a $100 credit cap.
Two local operator tools help avoid surprise spend — both act only via your own
`az login` session, commit no secrets, and are never run from CI.

### Budget alerts

`scripts/azure/provision-budget.sh` creates a monthly Cost Management budget that
**emails alerts** at 50/80/100% (actual) and 100% (forecast). It only alerts — it does
not cap or stop anything.

```bash
az login
scripts/azure/provision-budget.sh                                  # $30/mo, alerts to the Owner role
BUDGET_EMAIL=you@example.com scripts/azure/provision-budget.sh      # also email a specific inbox
```

Override `BUDGET_AMOUNT` / `BUDGET_NAME` via env vars; re-running updates the same
budget in place. Requires Cost Management Contributor or Owner on the subscription. If
the Consumption API is unavailable for the offer, create it in the portal instead
(Cost Management → Budgets).

### Pause / resume the baseline

`scripts/azure/lifecycle.sh` stops/starts the chargeable baseline for stretches when
you are not using the stack:

```bash
scripts/azure/lifecycle.sh pause    # stop Postgres + scale the agent to zero
scripts/azure/lifecycle.sh status   # show Postgres state + agent min-replicas
scripts/azure/lifecycle.sh resume   # start Postgres back up
```

Caveats:

- **While paused, the live site's database features do not work** — `resume` first.
- **Azure auto-restarts a stopped Flexible Server after ~7 days** — re-run `pause` for
  longer breaks.
- **The App Service B1 plan (~$13/mo) keeps billing while paused.** Stopping the apps
  does not reduce the plan charge. To go fully to ~$0 you must either downgrade the plan
  to Free (`az appservice plan update -g projects -n jobops-plan --sku F1` — Free has
  real limits: no always-on, reduced quotas, no custom-domain TLS) or delete the plan
  (destructive). These are manual, opt-in steps; the script does not do them.

`cool` vs `pause`: `demo.sh cool` only sleeps the agent (demo cost); `lifecycle.sh
pause` sleeps the whole baseline (DB + agent) for longer idle periods.
````

- [ ] **Step 2: Add a pointer in `docs/DEMO.md`**

In `docs/DEMO.md`, find the cost blockquote in the "Live cloud demo" section that
begins `> **Cost:** the agent at `min-replicas=1` bills`. Immediately after that
blockquote's closing line (the line ending `... env vars.`), insert this new line:

```markdown

> For longer idle periods (not just between demos), `scripts/azure/lifecycle.sh pause`
> stops the database and agent too — see "Cost controls" in `docs/AZURE_DEPLOYMENT.md`.
```

- [ ] **Step 3: Verify the docs edits + security guard**

Run:
```bash
grep -q "## Cost controls" docs/AZURE_DEPLOYMENT.md && echo "azure docs ok"
grep -q "lifecycle.sh pause" docs/DEMO.md && echo "demo docs ok"
grep -rl -e "provision-budget.sh" -e "lifecycle.sh" .github/workflows/ && echo "FAIL: workflow references a cost script" || echo "ok: no workflow references the cost scripts"
```
Expected: `azure docs ok`, `demo docs ok`, `ok: no workflow references the cost scripts`.

- [ ] **Step 4: Commit**

```bash
git add docs/AZURE_DEPLOYMENT.md docs/DEMO.md
git commit -m "docs: cost controls section (budget + pause/resume) and DEMO pointer"
```

---

## Task 4: Final verification + open the PR

**Files:** none.

- [ ] **Step 1: Re-run all local verification**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('scripts/azure/budget-template.json','utf8')); console.log('json ok')"
bash -n scripts/azure/provision-budget.sh && bash -n scripts/azure/lifecycle.sh && echo "syntax ok"
bash scripts/azure/lifecycle.test.sh | tail -1
git ls-files -s scripts/azure/provision-budget.sh scripts/azure/lifecycle.sh scripts/azure/lifecycle.test.sh
```
Expected: `json ok`, `syntax ok`, `ALL PASS`, and all three `.sh` files show mode `100755`.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin cost-controls
```

- [ ] **Step 3: Open the PR (do not merge)**

```bash
gh pr create --title "feat(ops): cost controls — budget alerts + pause/resume" --body "<summary: scripts/azure/provision-budget.sh deploys a \$30/mo subscription budget (alerts 50/80/100% actual + 100% forecast, Owner role + optional BUDGET_EMAIL, no email committed); scripts/azure/lifecycle.sh pause/resume/status stops/starts Postgres + scales the agent to zero, tolerating only the already-stopped/running case and failing loudly otherwise; docs cover the App Service caveat (manual F1 downgrade/delete). Security: local tools, az-login-only, no secrets, never in CI (guard-checked). Tests: budget template JSON parse, lifecycle dispatch unit tests, bash -n.>"
```
Expected: PR URL printed. Do **not** merge — the maintainer merges. Live verification
(`provision-budget.sh`; `lifecycle.sh status`/`pause`/`resume`) needs `az login`.

---

## Self-review notes

- **Spec coverage:** Component A (budget) ↔ Task 1 (template + script, subscription scope,
  4 notifications, Owner-role + optional `BUDGET_EMAIL`, idempotent); Component B
  (pause/resume) ↔ Task 2 (`lifecycle.sh` stop Postgres + agent min=0 / start Postgres /
  read-only status, tolerate-specific-error pattern, BASH_SOURCE guard, dispatch tests);
  Docs ↔ Task 3 (Cost controls section incl. the three caveats + App Service manual step,
  DEMO pointer, `cool` vs `pause`); Security ↔ no-CI grep (Task 3) + header comments +
  env-only email; Testing ↔ JSON parse + `bash -n` + dispatch tests + no-CI grep (Tasks 1–4).
- **No placeholders:** all template, script, test, and docs content is given in full.
- **Name consistency:** `jobops-monthly-30`, `BUDGET_EMAIL`/`BUDGET_AMOUNT`/`BUDGET_NAME`,
  `run_tolerating`, `cmd_pause/resume/status`, resource defaults (`projects`/`jobops`/
  `jobops-agent`) are identical across the script, tests, and docs.
- **Exec bit:** `git add --chmod=+x` sets `100755` directly (Windows `chmod` alone does not
  write the git index — learned on PR #33).
