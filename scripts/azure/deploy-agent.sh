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
  GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "==> Building $IMAGE:$TAG (linux/amd64, CPU torch — a few minutes)"
  docker build --platform linux/amd64 --build-arg GIT_SHA="$GIT_SHA" \
    -t "$IMAGE:$TAG" -t "$IMAGE:latest" services/agent
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
# Everything but the bare liveness probe needs the shared key (#348). Read it from the
# app's own secret so it never has to be copied anywhere.
key="$(az containerapp secret show -g "$RG" -n "$APP" --secret-name agent-api-key --query value -o tsv)"
health="000"
for _ in 1 2 3 4 5 6 7 8; do
  health="$(curl -s -o /dev/null -w '%{http_code}' --max-time 50 "https://$fqdn/health" || true)"
  [ "$health" = "200" ] && break
  sleep 5
done
stream="$(curl -s -H "X-Agent-Key: $key" "https://$fqdn/openapi.json" --max-time 50 | grep -c '/assistant/stream' || true)"
# The LLM canary: one tiny real model call, so a model the provider rejects fails the
# deploy instead of every user's request (#348).
canary_body="$(curl -s -H "X-Agent-Key: $key" -w '\n%{http_code}' --max-time 90 "https://$fqdn/health/llm" || true)"
canary="$(printf '%s' "$canary_body" | tail -n1)"

echo ""
echo "    health           : $health"
echo "    /assistant/stream: $([ "${stream:-0}" -gt 0 ] && echo 'present ✓' || echo 'MISSING ✗')"
echo "    LLM canary       : $canary $(printf '%s' "$canary_body" | sed '$d')"
echo "    agent            : https://$fqdn"

# Hard-fail on a bad activation so a broken deploy can't go unnoticed (the whole
# point of this tool is to make stale/broken agents impossible to miss).
if [ "$health" = "200" ] && [ "${stream:-0}" -gt 0 ] && [ "$canary" = "200" ]; then
  echo "==> Done ✓"
else
  echo "==> Verify FAILED — agent unhealthy, /assistant/stream missing, or the model call failed" >&2
  exit 1
fi
