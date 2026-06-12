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
