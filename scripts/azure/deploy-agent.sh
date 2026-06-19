#!/usr/bin/env bash
#
# One-command deploy for the JobOps agent (Azure Container App).
#
# Why this exists: unlike the API/web (auto-deployed by GitHub Actions), the agent
# Container App has NO fully-automated CI deploy — the Azure tenant (Azure for Students
# on purdue.edu) blocks creating the service principal that GitHub Actions would need to
# call ARM (`az containerapp update`). A forgotten step in the manual build→push→update
# sequence once left the deployed agent 8 days stale and broke the Assistant. This script
# collapses that whole sequence into one command (run locally with your `az login`).
#
# Usage:
#   az login                                            # if your token is stale
#   bash scripts/azure/deploy-agent.sh                  # build + push + activate + verify
#   bash scripts/azure/deploy-agent.sh --activate <tag> # activate an already-pushed tag
#                                                        # (e.g. a CI-built image:  <git-sha>)
#
# The CI workflow .github/workflows/deploy-agent.yml auto-builds + pushes on every
# services/agent change, so `--activate <sha>` lets you skip the slow local build.
set -euo pipefail

RG="${RG:-projects}"
APP="${APP:-jobops-agent}"
ACR="${ACR:-ca9ee6437892acr}"
IMAGE="$ACR.azurecr.io/jobops-agent"

activate_tag=""
if [ "${1:-}" = "--activate" ]; then
  activate_tag="${2:?Provide a tag, e.g. --activate <git-sha>}"
fi

if [ -z "$activate_tag" ]; then
  TAG="${TAG:-$(date +%Y%m%d%H%M)}"
  echo "==> Building $IMAGE:$TAG (linux/amd64, CPU torch — a few minutes)"
  docker build --platform linux/amd64 -t "$IMAGE:$TAG" -t "$IMAGE:latest" services/agent
  echo "==> Logging in to ACR + pushing"
  az acr login -n "$ACR"
  docker push "$IMAGE:$TAG"
  docker push "$IMAGE:latest"
  deploy_tag="$TAG"
else
  deploy_tag="$activate_tag"
fi

echo "==> Updating Container App $APP -> $IMAGE:$deploy_tag"
az containerapp update -g "$RG" -n "$APP" --image "$IMAGE:$deploy_tag" -o none

echo "==> Verifying the new revision (waking the scale-to-zero app)"
fqdn="$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
health="000"
for _ in 1 2 3 4 5 6 7 8; do
  health="$(curl -s -o /dev/null -w '%{http_code}' --max-time 50 "https://$fqdn/health" || true)"
  [ "$health" = "200" ] && break
  sleep 5
done
stream="$(curl -s "https://$fqdn/openapi.json" --max-time 50 | grep -c '/assistant/stream' || true)"

echo ""
echo "==> Done."
echo "    health           : $health"
echo "    /assistant/stream: $([ "${stream:-0}" -gt 0 ] && echo 'present ✓' || echo 'MISSING ✗')"
echo "    agent            : https://$fqdn"
