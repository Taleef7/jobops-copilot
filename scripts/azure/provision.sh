#!/usr/bin/env bash
#
# Provision JobOps Copilot on Azure App Service (+ pgvector, App Insights).
# Idempotent-ish: safe to re-run. Requires: az login completed.
#
# Usage:
#   RESOURCE_GROUP=jobops-rg LOCATION=eastus PG_SERVER=jobops \
#   ANTHROPIC_API_KEY=... DATABASE_URL=... bash scripts/azure/provision.sh
#
set -euo pipefail

# ---- Config (override via env) --------------------------------------------
RESOURCE_GROUP="${RESOURCE_GROUP:-jobops-rg}"
LOCATION="${LOCATION:-eastus}"
PLAN="${PLAN:-jobops-plan}"
PLAN_SKU="${PLAN_SKU:-B1}"                 # B1 has ~1.75GB RAM; bump for RAG/torch
WEB_APP="${WEB_APP:-jobops-web}"
API_APP="${API_APP:-jobops-api}"
AGENT_APP="${AGENT_APP:-jobops-agent}"
APPINSIGHTS="${APPINSIGHTS:-jobops-insights}"

PG_SERVER="${PG_SERVER:-jobops}"           # Postgres Flexible Server name
PG_RESOURCE_GROUP="${PG_RESOURCE_GROUP:-$RESOURCE_GROUP}"

DATABASE_URL="${DATABASE_URL:-}"
LLM_PROVIDER="${LLM_PROVIDER:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
GOOGLE_GEMINI_API_KEY="${GOOGLE_GEMINI_API_KEY:-}"

echo "==> Resource group"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

echo "==> Linux App Service plan ($PLAN_SKU)"
az appservice plan create -g "$RESOURCE_GROUP" -n "$PLAN" --is-linux --sku "$PLAN_SKU" -o none

echo "==> Web (Next.js, Node 20)"
az webapp create -g "$RESOURCE_GROUP" -p "$PLAN" -n "$WEB_APP" --runtime "NODE:20-lts" -o none
echo "==> API (Express, Node 20)"
az webapp create -g "$RESOURCE_GROUP" -p "$PLAN" -n "$API_APP" --runtime "NODE:20-lts" -o none
echo "==> Agent (Python 3.12) — for full RAG/torch, prefer a container; see Dockerfile"
az webapp create -g "$RESOURCE_GROUP" -p "$PLAN" -n "$AGENT_APP" --runtime "PYTHON:3.12" -o none

echo "==> Application Insights"
az extension add --name application-insights --only-show-errors >/dev/null 2>&1 || true
az monitor app-insights component create --app "$APPINSIGHTS" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none || true
AI_CONN="$(az monitor app-insights component show --app "$APPINSIGHTS" -g "$RESOURCE_GROUP" \
  --query connectionString -o tsv 2>/dev/null || echo '')"

WEB_URL="https://$(az webapp show -g "$RESOURCE_GROUP" -n "$WEB_APP" --query defaultHostName -o tsv)"
API_URL="https://$(az webapp show -g "$RESOURCE_GROUP" -n "$API_APP" --query defaultHostName -o tsv)"
AGENT_URL="https://$(az webapp show -g "$RESOURCE_GROUP" -n "$AGENT_APP" --query defaultHostName -o tsv)"

echo "==> App settings"
az webapp config appsettings set -g "$RESOURCE_GROUP" -n "$WEB_APP" -o none --settings \
  NEXT_PUBLIC_API_BASE_URL="$API_URL" \
  APPLICATIONINSIGHTS_CONNECTION_STRING="$AI_CONN"

az webapp config appsettings set -g "$RESOURCE_GROUP" -n "$API_APP" -o none --settings \
  AGENT_SERVICE_URL="$AGENT_URL" \
  DATABASE_URL="$DATABASE_URL" \
  API_PUBLIC_BASE_URL="$API_URL" \
  APPLICATIONINSIGHTS_CONNECTION_STRING="$AI_CONN"

az webapp config appsettings set -g "$RESOURCE_GROUP" -n "$AGENT_APP" -o none --settings \
  LLM_PROVIDER="$LLM_PROVIDER" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  GOOGLE_GEMINI_API_KEY="$GOOGLE_GEMINI_API_KEY" \
  DATABASE_URL="$DATABASE_URL" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true" \
  APPLICATIONINSIGHTS_CONNECTION_STRING="$AI_CONN"

echo "==> Enable pgvector on Postgres Flexible Server (allow-list + restart)"
az postgres flexible-server parameter set -g "$PG_RESOURCE_GROUP" -s "$PG_SERVER" \
  --name azure.extensions --value vector -o none || \
  echo "   (skipped: check PG_SERVER/PG_RESOURCE_GROUP)"
az postgres flexible-server restart -g "$PG_RESOURCE_GROUP" -s "$PG_SERVER" -o none || true

echo "==> Allow Azure services to reach Postgres"
az postgres flexible-server firewall-rule create -g "$PG_RESOURCE_GROUP" -n "$PG_SERVER" \
  --rule-name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none || true

cat <<EOF

Provisioned:
  web   : $WEB_URL
  api   : $API_URL
  agent : $AGENT_URL

Next:
  1) Set GitHub repo vars:    AZURE_WEBAPP_NAME_WEB=$WEB_APP, AZURE_WEBAPP_NAME_API=$API_APP, AZURE_WEBAPP_NAME_AGENT=$AGENT_APP
     and publish-profile secrets (az webapp deployment list-publishing-profiles --xml).
  2) Run the "Deploy Azure App Service" workflow (target: all), or 'az webapp up' per app.
  3) Bootstrap the DB schema (incl. embeddings): npm run db:init --workspace @jobops/api
EOF
