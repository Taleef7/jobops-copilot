#!/usr/bin/env bash
# Provision workspace-based Application Insights for JobOps with a 1 GB/day cap.
# Idempotent-ish: re-running create on an existing resource is a no-op/update.
set -euo pipefail

# On Windows Git Bash, stop MSYS from rewriting the ARM resource id
# (/subscriptions/...) into a C:\ path when passed to --workspace. No-op elsewhere.
export MSYS_NO_PATHCONV=1

RG=projects
LOCATION=eastus
WORKSPACE=jobops-logs
COMPONENT=jobops-insights

az extension add -n application-insights -y

az monitor log-analytics workspace create \
  --resource-group "$RG" --workspace-name "$WORKSPACE" --location "$LOCATION"

# 1 GB/day ingestion cap (guarantees ~$0). -1 would mean unlimited.
az monitor log-analytics workspace update \
  --resource-group "$RG" --workspace-name "$WORKSPACE" --quota 1

WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group "$RG" --workspace-name "$WORKSPACE" --query id -o tsv)

az monitor app-insights component create \
  --app "$COMPONENT" --resource-group "$RG" --location "$LOCATION" \
  --workspace "$WORKSPACE_ID" --application-type web

az monitor app-insights component show \
  --app "$COMPONENT" --resource-group "$RG" --query connectionString -o tsv
