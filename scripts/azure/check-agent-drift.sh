#!/usr/bin/env bash
#
# Detect a stale agent deployment: the Container App can lag `main` because the
# deploy-agent CI only builds+pushes to ACR (the Azure-for-Students tenant blocks
# the service principal needed to call ARM), so activation is a manual local step
# that is easy to forget. This script compares the SHA baked into the *running*
# image (exposed at /health as `build_sha`) against the latest commit that would
# have triggered a build. It needs only a public HTTP GET — no ARM access — so it
# runs both locally and in a scheduled GitHub Actions job.
#
# Usage:  AGENT_FQDN=<host> bash scripts/azure/check-agent-drift.sh
# Exit:   0 = in sync, 1 = drift OR the agent is unreachable
# Outputs (when $GITHUB_OUTPUT is set): reason=ok|stale|unreachable, expected, live
set -euo pipefail

FQDN="${AGENT_FQDN:?Set AGENT_FQDN to the agent Container App hostname}"

emit() { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT" || true; }
summary() { cat >>"${GITHUB_STEP_SUMMARY:-/dev/stderr}"; }

# The build trigger is `services/agent/**` + the workflow file, so the newest
# commit touching either is the SHA the latest image was (or should be) built from.
EXPECTED="$(git log -1 --format=%H -- services/agent .github/workflows/deploy-agent.yml)"
emit expected "$EXPECTED"

# Capture the body and HTTP status together. --max-time is generous because the
# agent scales to zero, so the first hit is a cold start.
RESP="$(curl -s --max-time 70 -w $'\n%{http_code}' "https://${FQDN}/health" || true)"
HTTP="$(printf '%s' "$RESP" | tail -n1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"
LIVE="$(printf '%s' "$BODY" | sed -n 's/.*"build_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
emit live "$LIVE"

echo "expected (latest agent build commit): ${EXPECTED}"
echo "live agent: HTTP ${HTTP:-000}, build_sha ${LIVE:-<none>}"

# Distinguish an outage from a stale-but-healthy agent so the alert is actionable.
if [ "$HTTP" != "200" ]; then
  emit reason unreachable
  summary <<MD
## 🔴 Agent deployment check failed — agent unreachable

\`GET /health\` did not return 200 (got \`${HTTP:-no response}\`). The agent may be down, scaling from zero slower than the timeout, or mid-deploy.
MD
  echo "✗ agent unreachable (HTTP ${HTTP:-000})" >&2
  exit 1
fi

if [ -n "$LIVE" ] && [ "$LIVE" = "$EXPECTED" ]; then
  emit reason ok
  echo "✓ Deployed agent is current."
  exit 0
fi

emit reason stale
{
  printf '## 🔴 Agent deployment is stale (image drift)\n\n'
  printf 'Live agent is running `%s` but the latest agent build is `%s`.\n\n' \
    "${LIVE:-<no build_sha — image predates SHA-stamping>}" "$EXPECTED"
  printf 'Activate the current image locally (needs your `az login`):\n'
  printf '```bash\nbash scripts/azure/deploy-agent.sh --activate %s\n```\n' "$EXPECTED"
} | summary
echo "✗ DRIFT: deployed agent does not match the latest build." >&2
exit 1
