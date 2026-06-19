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
# Exit:   0 = in sync, 1 = drift (or the agent is unreachable / unstamped)
set -euo pipefail

FQDN="${AGENT_FQDN:?Set AGENT_FQDN to the agent Container App hostname}"

# The build trigger is `services/agent/**` + the workflow file, so the newest
# commit touching either is the SHA the latest image was (or should be) built from.
EXPECTED="$(git log -1 --format=%H -- services/agent .github/workflows/deploy-agent.yml)"

# --max-time is generous: the agent scales to zero, so the first hit is a cold start.
HEALTH="$(curl -s --max-time 70 "https://${FQDN}/health" || true)"
LIVE="$(printf '%s' "$HEALTH" | sed -n 's/.*"build_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

echo "expected (latest agent build commit): ${EXPECTED}"
echo "live agent build_sha:                 ${LIVE:-<missing>}"

if [ -n "$LIVE" ] && [ "$LIVE" = "$EXPECTED" ]; then
  echo "✓ Deployed agent is current."
  exit 0
fi

# Drift (or the running image predates SHA-stamping / the agent is unreachable).
{
  echo "## 🔴 Deployed agent is stale (image drift)"
  echo ""
  if [ -z "$LIVE" ]; then
    echo "The live agent reported no \`build_sha\` (unreachable, or running an image built before SHA-stamping)."
  else
    echo "Live agent is running \`${LIVE}\` but the latest agent build is \`${EXPECTED}\`."
  fi
  echo ""
  echo "Activate the current image locally (needs your \`az login\`):"
  echo '```bash'
  echo "bash scripts/azure/deploy-agent.sh --activate ${EXPECTED}"
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"

echo "✗ DRIFT: deployed agent does not match the latest build." >&2
exit 1
