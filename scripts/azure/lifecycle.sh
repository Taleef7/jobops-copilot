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
