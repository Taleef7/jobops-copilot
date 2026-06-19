#!/usr/bin/env bash
#
# Read-only smoke checks against the LIVE stack — auth boundaries, CORS, the
# public surfaces, and agent freshness. Safe to run repeatedly; changes nothing.
# (The per-user daily AI budget kill-switch is a *config* test — see docs/TESTING.md —
#  and is deliberately NOT here because it mutates an App Service setting.)
#
# Usage:  bash scripts/verify-live.sh
set -uo pipefail

WEB="https://jobops-web.azurewebsites.net"
API="https://jobops-api.azurewebsites.net"
AGENT="https://jobops-agent.blackcliff-644a2f24.eastus.azurecontainerapps.io"

pass=0; fail=0
code() { curl -s -m 25 -o /dev/null -w '%{http_code}' "$@"; }
check() { # check "<label>" "<expected>" "<actual>"
  if [ "$2" = "$3" ]; then printf '  ✓ %-46s %s\n' "$1" "$3"; pass=$((pass+1));
  else printf '  ✗ %-46s got %s, expected %s\n' "$1" "$3" "$2"; fail=$((fail+1)); fi
}

echo "== Health =="
check "API /api/health"                "200" "$(code "$API/api/health")"
check "agent /health (exempt)"         "200" "$(code "$AGENT/health")"
check "agent /openapi.json (exempt)"   "200" "$(code "$AGENT/openapi.json")"

echo "== Agent service-to-service auth (QA·A) =="
check "agent /rag/search unauth -> 401" "401" "$(code -X POST "$AGENT/rag/search" -H 'Content-Type: application/json' -d '{"query":"x"}')"
check "agent /score-fit unauth -> 401"  "401" "$(code -X POST "$AGENT/score-fit"  -H 'Content-Type: application/json' -d '{}')"
check "agent wrong-key -> 401"          "401" "$(code -X POST "$AGENT/rag/search" -H 'Authorization: Bearer nope' -H 'Content-Type: application/json' -d '{"query":"x"}')"

echo "== API auth boundaries =="
check "API job detail unauth -> 401"    "401" "$(code "$API/api/jobs/00000000-0000-0000-0000-000000000000")"
check "n8n webhook unauth -> 401"       "401" "$(code -X POST "$API/api/n8n/job-intake" -H 'Content-Type: application/json' -d '{}')"
check "assistant stream unauth -> 401"  "401" "$(code -X POST "$API/api/ai/assistant/stream" -H 'Content-Type: application/json' -d '{}')"

echo "== CORS allowlist (QA·F) =="
acao_evil="$(curl -s -m 25 -D - -o /dev/null -H "Origin: https://evil.example.com" "$API/api/health" | grep -i 'access-control-allow-origin' | tr -d '\r')"
acao_web="$(curl -s -m 25 -D - -o /dev/null -H "Origin: $WEB" "$API/api/health" | grep -io 'access-control-allow-origin:.*' | tr -d '\r')"
check "disallowed origin -> no ACAO"    ""    "$acao_evil"
[ -n "$acao_web" ] && printf '  ✓ %-46s %s\n' "web origin -> ACAO echoed" "$acao_web" && pass=$((pass+1)) || { printf '  ✗ web origin missing ACAO\n'; fail=$((fail+1)); }

echo "== Public surface (QA·H) =="
robots="$(curl -s -m 25 "$WEB/robots.txt")"
echo "$robots" | grep -q 'Disallow: /dashboard' && printf '  ✓ robots.txt disallows authed routes\n' && pass=$((pass+1)) || { printf '  ✗ robots.txt missing authed-route disallow\n'; fail=$((fail+1)); }

echo "== Agent freshness (#110) =="
live_sha="$(curl -s -m 70 "$AGENT/health" | sed -n 's/.*"build_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
printf '  • live agent build_sha: %s\n' "${live_sha:-<none>}"

echo ""
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
