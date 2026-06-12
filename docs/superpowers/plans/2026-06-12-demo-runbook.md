# Live Demo Runbook + Agent Warm-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local operator script `scripts/azure/demo.sh` (`warm` / `status` / `cool`) plus a runbook section so the deployed stack can be made demo-ready and returned to idle with one command each.

**Architecture:** A single `set -euo pipefail` bash script with subcommand dispatch. Pure helpers (IPv4 validation, usage) are unit-tested via sourcing; the `az`/`curl` side-effecting commands are verified live. Resource names default to the real deployment and are env-overridable. The script carries no secrets and is never invoked by CI — all authority is the operator's `az login` session.

**Tech Stack:** Bash, Azure CLI (`az containerapp`, `az postgres flexible-server firewall-rule`), `curl`.

**Spec:** `docs/superpowers/specs/2026-06-12-demo-runbook-design.md`

---

## File Structure

- **Create** `scripts/azure/demo.sh` — the warm/status/cool operator script (one responsibility: toggle demo readiness of the live stack).
- **Create** `scripts/azure/demo.test.sh` — unit tests for the pure helpers + dispatch (no Azure calls).
- **Modify** `docs/DEMO.md` — add a "Live cloud demo (deployed stack)" section.

---

## Task 1: The `demo.sh` script + unit tests (TDD for pure logic)

**Files:**
- Create: `scripts/azure/demo.test.sh`
- Create: `scripts/azure/demo.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/azure/demo.test.sh` with exactly:

```bash
#!/usr/bin/env bash
# Unit tests for demo.sh pure helpers + dispatch (no Azure calls).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source without running main() — demo.sh guards main behind a BASH_SOURCE check.
# shellcheck source=/dev/null
source "$DIR/demo.sh"
set +e  # demo.sh enables -e; disable it so assertions can observe failures.

fail=0
assert_ok()   { if "$@"; then echo "ok:        $*"; else echo "FAIL (want ok):   $*"; fail=1; fi; }
assert_fail() { if "$@"; then echo "FAIL (want no):   $*"; fail=1; else echo "ok (rejected): $*"; fi; }

# Valid IPv4 addresses
assert_ok   is_ipv4 "1.2.3.4"
assert_ok   is_ipv4 "192.168.0.255"
assert_ok   is_ipv4 "50.221.78.186"
# Invalid / hostile inputs must be rejected
assert_fail is_ipv4 "256.1.1.1"
assert_fail is_ipv4 "1.2.3"
assert_fail is_ipv4 "1.2.3.4.5"
assert_fail is_ipv4 "abc"
assert_fail is_ipv4 "1.2.3.4; rm -rf /"
assert_fail is_ipv4 ""
assert_fail is_ipv4 "1.2.3.04abc"

# Dispatch: no-arg prints usage and exits 2; unknown subcommand exits 1.
bash "$DIR/demo.sh" >/dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok:        no-arg exits 2" || { echo "FAIL: no-arg exit code"; fail=1; }
bash "$DIR/demo.sh" bogus >/dev/null 2>&1; [ "$?" -eq 1 ] && echo "ok:        bad subcommand exits 1" || { echo "FAIL: bad subcommand exit code"; fail=1; }
bash "$DIR/demo.sh" --help >/dev/null 2>&1; [ "$?" -eq 0 ] && echo "ok:        --help exits 0" || { echo "FAIL: --help exit code"; fail=1; }

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/azure/demo.test.sh`
Expected: FAIL — `source` errors because `scripts/azure/demo.sh` does not exist yet.

- [ ] **Step 3: Write `scripts/azure/demo.sh`**

Create `scripts/azure/demo.sh` with exactly:

```bash
#!/usr/bin/env bash
#
# demo.sh — make the live JobOps stack demo-ready, then return it to idle.
#
# SECURITY / SAFETY
#   - LOCAL OPERATOR TOOL. Never invoke this from CI or any automation that holds
#     stored cloud credentials. All authority comes from the operator's own
#     `az login` session (Azure RBAC).
#   - Contains no secrets, keys, connection strings, or IDs — only non-secret
#     resource names (overridable via env vars). Your public IP is fetched at
#     runtime and never written to the repo.
#
# Usage:
#   scripts/azure/demo.sh warm     # agent->min1, DB firewall for this IP, health-gate
#   scripts/azure/demo.sh status   # read-only health check of web/api/agent
#   scripts/azure/demo.sh cool      # agent->min0, remove the firewall rule
#
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-projects}"
AGENT_APP="${AGENT_APP:-jobops-agent}"
WEB_APP="${WEB_APP:-jobops-web}"
API_APP="${API_APP:-jobops-api}"
PG_RESOURCE_GROUP="${PG_RESOURCE_GROUP:-projects}"
PG_SERVER="${PG_SERVER:-jobops}"
FIREWALL_RULE="${FIREWALL_RULE:-demo-warmup}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-15}"

log()  { printf '\033[1;34m[demo]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[demo]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[demo]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: demo.sh <warm|status|cool>

  warm    Scale the agent to min-replicas=1, allow-list this machine's IP on the
          Postgres firewall, and wait until web/api/agent are healthy.
  status  Read-only health check of web, api (/api/health/ready) and the agent.
  cool    Scale the agent back to min-replicas=0 and remove the firewall rule.

Resource names default to the live deployment and can be overridden via env vars:
RESOURCE_GROUP, AGENT_APP, WEB_APP, API_APP, PG_RESOURCE_GROUP, PG_SERVER.
EOF
}

# Strict IPv4 validation: structurally valid AND every octet in 0..255.
is_ipv4() {
  local ip="${1:-}"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS='.'
  local -a octets
  read -r -a octets <<< "$ip"
  local o
  for o in "${octets[@]}"; do
    (( 10#$o >= 0 && 10#$o <= 255 )) || return 1
  done
  return 0
}

require_tools() {
  command -v az >/dev/null 2>&1 || die "Azure CLI 'az' not found. Install: https://aka.ms/azcli"
  command -v curl >/dev/null 2>&1 || die "'curl' not found on PATH."
}

require_login() {
  az account show >/dev/null 2>&1 || die "Not logged in to Azure. Run: az login"
}

preflight() { require_tools; require_login; }

web_url() { printf 'https://%s.azurewebsites.net' "$WEB_APP"; }
api_url() { printf 'https://%s.azurewebsites.net' "$API_APP"; }

agent_url() {
  local fqdn
  fqdn="$(az containerapp show -g "$RESOURCE_GROUP" -n "$AGENT_APP" \
    --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null)" \
    || die "Could not read the agent FQDN (check RESOURCE_GROUP/AGENT_APP and your login)."
  [[ -n "$fqdn" ]] || die "Agent '$AGENT_APP' has no ingress FQDN."
  printf 'https://%s' "$fqdn"
}

# One health pass over all three endpoints. Returns 0 only if all are good.
check_once() {
  local agent web api status=0
  agent="$(agent_url)"; web="$(web_url)"; api="$(api_url)"

  if curl -fsS --max-time 10 -o /dev/null "$agent/health"; then
    log "agent  OK  $agent/health"
  else
    warn "agent  --  $agent/health"; status=1
  fi

  if curl -fsS --max-time 10 "$api/api/health/ready" 2>/dev/null | grep -Eq '"db"[[:space:]]*:[[:space:]]*"ok"'; then
    log "api    OK  $api/api/health/ready (db ok)"
  else
    warn "api    --  $api/api/health/ready (db not ok)"; status=1
  fi

  if curl -fsS --max-time 10 -o /dev/null "$web/"; then
    log "web    OK  $web/"
  else
    warn "web    --  $web/"; status=1
  fi

  return "$status"
}

wait_healthy() {
  local i
  for (( i=1; i<=HEALTH_RETRIES; i++ )); do
    log "health check ${i}/${HEALTH_RETRIES} ..."
    if check_once; then
      log "all endpoints healthy."
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  die "stack did not become healthy within $((HEALTH_RETRIES * HEALTH_INTERVAL))s."
}

cmd_warm() {
  preflight
  log "scaling agent '$AGENT_APP' to min-replicas=1 ..."
  az containerapp update -g "$RESOURCE_GROUP" -n "$AGENT_APP" --min-replicas 1 -o none \
    || die "failed to scale up the agent."

  log "fetching current public IP ..."
  local ip
  ip="$(curl -fsS --max-time 10 https://api.ipify.org)" || die "could not fetch public IP."
  is_ipv4 "$ip" || die "refusing to use non-IPv4 value from IP service: '$ip'"
  log "allow-listing $ip on Postgres '$PG_SERVER' (rule '$FIREWALL_RULE') ..."
  az postgres flexible-server firewall-rule create -g "$PG_RESOURCE_GROUP" -n "$PG_SERVER" \
    --rule-name "$FIREWALL_RULE" --start-ip-address "$ip" --end-ip-address "$ip" -o none \
    || die "failed to set the firewall rule."

  wait_healthy
  log "READY for the live demo:"
  log "  web:   $(web_url)"
  log "  api:   $(api_url)/api/health"
  log "  agent: $(agent_url)/health"
  warn "Run 'demo.sh cool' after the demo — the agent at min-replicas=1 bills ~\$20-30/mo if left on."
}

cmd_status() {
  preflight
  if check_once; then
    log "stack is demo-ready."
  else
    die "stack is not fully ready (see lines marked -- above)."
  fi
}

cmd_cool() {
  preflight
  log "scaling agent '$AGENT_APP' to min-replicas=0 ..."
  az containerapp update -g "$RESOURCE_GROUP" -n "$AGENT_APP" --min-replicas 0 -o none \
    || die "failed to scale down the agent."
  log "removing firewall rule '$FIREWALL_RULE' ..."
  az postgres flexible-server firewall-rule delete -g "$PG_RESOURCE_GROUP" -n "$PG_SERVER" \
    --rule-name "$FIREWALL_RULE" --yes -o none 2>/dev/null \
    || warn "firewall rule '$FIREWALL_RULE' not present (already removed)."
  log "stack is back to idle (agent scale-to-zero, demo firewall rule removed)."
}

main() {
  case "${1:-}" in
    warm)   cmd_warm ;;
    status) cmd_status ;;
    cool)   cmd_cool ;;
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

- [ ] **Step 4: Make both scripts executable**

Run:
```bash
chmod +x scripts/azure/demo.sh scripts/azure/demo.test.sh
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash scripts/azure/demo.test.sh`
Expected: every line prints `ok` / `ok (rejected)` and the last line is `ALL PASS`.

- [ ] **Step 6: Lint the script**

Run: `bash -n scripts/azure/demo.sh && echo "syntax ok"`
Expected: prints `syntax ok`.
Then, if shellcheck is available: `command -v shellcheck >/dev/null && shellcheck scripts/azure/demo.sh || echo "shellcheck not installed; skipped"`
Expected: no errors, or the skip message.

- [ ] **Step 7: Commit**

```bash
git add scripts/azure/demo.sh scripts/azure/demo.test.sh
git commit -m "feat(ops): demo.sh warm/status/cool for the live stack (agent warm-up + DB firewall)"
```

---

## Task 2: Runbook section in `docs/DEMO.md`

**Files:**
- Modify: `docs/DEMO.md`

- [ ] **Step 1: Insert the live-demo section**

In `docs/DEMO.md`, insert the following block immediately before the line
`## What to emphasize in the interview`:

```markdown
## Live cloud demo (deployed stack)

To present from the **deployed** stack instead of local servers, use the operator
script `scripts/azure/demo.sh` (needs `az login`; it acts only via your own Azure
session and stores no credentials):

```bash
az login                         # if your token has expired
scripts/azure/demo.sh warm       # wake the agent + allow-list your IP + health-gate
# ... present using the live web URL that 'warm' prints ...
scripts/azure/demo.sh cool       # back to scale-to-zero idle + remove the firewall rule
```

- `warm` scales the Container App agent to `min-replicas=1`, adds a single
  fixed-name Postgres firewall rule for your current IP, and waits until web, API
  (`/api/health/ready` → `db:ok`) and agent (`/health`) are all green.
- `status` runs the same checks read-only (safe anytime).
- `cool` returns the agent to scale-to-zero and deletes the firewall rule.

> **Cost:** the agent at `min-replicas=1` bills ~$20–30/mo on 1 vCPU / 2 GiB, so
> always run `cool` after the demo. Resource names default to the live deployment
> (resource group `projects`, agent region `eastus`) and can be overridden with the
> `RESOURCE_GROUP` / `AGENT_APP` / `WEB_APP` / `API_APP` / `PG_SERVER` env vars.
```

- [ ] **Step 2: Verify the script is NOT referenced by any workflow (security guard)**

Run:
```bash
grep -rl "demo.sh" .github/workflows/ && echo "FAIL: demo.sh referenced by a workflow" || echo "ok: no workflow references demo.sh"
```
Expected: prints `ok: no workflow references demo.sh`.

- [ ] **Step 3: Verify the docs edit landed**

Run:
```bash
grep -q "Live cloud demo (deployed stack)" docs/DEMO.md && echo "docs ok"
```
Expected: prints `docs ok`.

- [ ] **Step 4: Commit**

```bash
git add docs/DEMO.md
git commit -m "docs: live cloud demo runbook (warm/status/cool) in DEMO.md"
```

---

## Task 3: Final verification + open the PR

**Files:** none.

- [ ] **Step 1: Re-run the full local verification**

Run:
```bash
bash scripts/azure/demo.test.sh && bash -n scripts/azure/demo.sh && grep -rl "demo.sh" .github/workflows/ >/dev/null && echo "WORKFLOW LEAK" || echo "verification clean"
```
Expected: test prints `ALL PASS`, then `verification clean` (the `grep` finds nothing, so the `||` branch runs).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin demo-runbook
```

- [ ] **Step 3: Open the PR (do not merge)**

```bash
gh pr create --title "feat(ops): live demo runbook + agent warm-up (demo.sh)" --body "<summary: scripts/azure/demo.sh warm/status/cool to make the deployed stack demo-ready and return it to idle; health gate reuses /api/health/ready; security: no secrets, az-login-only authority, never wired into CI, IPv4-validated input, single fixed-name /32 firewall rule removed by cool; unit tests for is_ipv4 + dispatch; DEMO.md runbook section.>"
```
Expected: PR URL printed. Do **not** merge — the maintainer merges. Live verification
(`demo.sh status` / `warm` / `cool`) requires `az login` and is run by the maintainer.

---

## Self-review notes

- **Spec coverage:** `warm`/`status`/`cool` (Task 1) ↔ spec Architecture; real resource
  targets + env overrides (Task 1 config) ↔ spec "Real deployment targets"; health gate on
  `/api/health/ready` + agent `/health` + web 200 (Task 1 `check_once`/`wait_healthy`) ↔
  spec `warm`/Goals; Security points 1–5 ↔ header comment + `is_ipv4` validation + Task 2
  no-workflow grep + fixed-name /32 rule + `cool` deletes it; runbook (Task 2) ↔ spec Docs;
  testing (`bash -n`, shellcheck, unit tests, no-CI grep) ↔ spec Testing.
- **No placeholders:** all script, test, and docs content is given in full.
- **Name consistency:** `is_ipv4`, `check_once`, `wait_healthy`, `preflight`, `cmd_warm/status/cool`,
  `FIREWALL_RULE=demo-warmup` are used identically in the script and referenced consistently
  in the tests and docs.
- **`10#$o`** forces base-10 octet comparison so values like `08`/`09` don't trip bash's
  octal parsing.
