#!/usr/bin/env bash
# Provision Azure Monitor alerts + a portal dashboard for the JobOps App Insights
# component (jobops-insights): an email action group, two failure metric alerts,
# and a 4-tile dashboard.
#
# SECURITY: local operator tool — never run from CI. Authority is your own
# `az login` session. No secrets/IDs are committed; ALERT_EMAIL is read from your live
# `az` session (or the env var) at deploy time and never written to the repo.
#
# Usage:
#   scripts/azure/provision-monitoring.sh
#   ALERT_EMAIL=you@example.com scripts/azure/provision-monitoring.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

RESOURCE_GROUP="${RESOURCE_GROUP:-projects}"
LOCATION="${LOCATION:-eastus}"
COMPONENT="${COMPONENT:-jobops-insights}"
ACTION_GROUP="${ACTION_GROUP:-jobops-alerts}"
ACTION_SHORT="${ACTION_SHORT:-jobops}"
DASHBOARD_NAME="${DASHBOARD_NAME:-jobops-monitoring}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

# Fail early with a clear message if not logged in.
az account show -o none

# An action-group email receiver requires an address. Default to the signed-in
# account's email (its UPN); otherwise ask for ALERT_EMAIL.
if [[ -z "$ALERT_EMAIL" ]]; then
  ALERT_EMAIL="$(az account show --query user.name -o tsv 2>/dev/null || true)"
fi
if [[ -z "$ALERT_EMAIL" || "$ALERT_EMAIL" != *@*.* ]]; then
  echo "ERROR: an alert email is required. Re-run with ALERT_EMAIL=you@example.com" >&2
  exit 1
fi

echo "Resolving App Insights component '$COMPONENT' ..." >&2
COMPONENT_ID="$(az resource show -g "$RESOURCE_GROUP" -n "$COMPONENT" \
  --resource-type microsoft.insights/components --query id -o tsv)" \
  || { echo "ERROR: could not find App Insights component '$COMPONENT' in '$RESOURCE_GROUP'." >&2; exit 1; }

echo "Creating/updating action group '$ACTION_GROUP' (email: $ALERT_EMAIL) ..." >&2
az monitor action-group create -g "$RESOURCE_GROUP" -n "$ACTION_GROUP" \
  --short-name "$ACTION_SHORT" --action email jobops-email "$ALERT_EMAIL" -o none

AG_ID="$(az monitor action-group show -g "$RESOURCE_GROUP" -n "$ACTION_GROUP" --query id -o tsv)"

echo "Creating/updating metric alert 'jobops-failed-requests' ..." >&2
az monitor metrics alert create -n "jobops-failed-requests" -g "$RESOURCE_GROUP" \
  --scopes "$COMPONENT_ID" \
  --condition "total requests/failed >= 5" \
  --window-size 5m --evaluation-frequency 1m --severity 2 \
  --action "$AG_ID" \
  --description "JobOps: 5+ failed HTTP requests in 5 minutes." -o none

echo "Creating/updating metric alert 'jobops-server-exceptions' ..." >&2
az monitor metrics alert create -n "jobops-server-exceptions" -g "$RESOURCE_GROUP" \
  --scopes "$COMPONENT_ID" \
  --condition "total exceptions/server >= 5" \
  --window-size 5m --evaluation-frequency 1m --severity 2 \
  --action "$AG_ID" \
  --description "JobOps: 5+ server exceptions in 5 minutes." -o none

echo "Deploying dashboard '$DASHBOARD_NAME' ..." >&2
az deployment group create -g "$RESOURCE_GROUP" --name "jobops-dashboard-deploy" \
  --template-file "$(dirname "$0")/dashboard-template.json" \
  --parameters dashboardName="$DASHBOARD_NAME" componentId="$COMPONENT_ID" \
               componentName="$COMPONENT" location="$LOCATION" -o none

echo "Monitoring set up:" >&2
echo "  alerts -> $ALERT_EMAIL (action group '$ACTION_GROUP')" >&2
echo "  rules  : jobops-failed-requests, jobops-server-exceptions" >&2
echo "  dashboard: '$DASHBOARD_NAME' (Azure portal > Dashboard)" >&2
