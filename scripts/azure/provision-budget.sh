#!/usr/bin/env bash
# Provision a monthly Cost Management budget for the JobOps subscription, with
# alerts at 50/80/100% (actual) and 100% (forecast) to the Owner role (and an
# optional explicit email).
#
# SECURITY: local operator tool — never run from CI. Authority is your own
# `az login` session. No secrets/IDs are committed; BUDGET_EMAIL (if used) is a
# deploy-time env var and is never written to the repo.
#
# Usage:
#   scripts/azure/provision-budget.sh
#   BUDGET_EMAIL=you@example.com BUDGET_AMOUNT=30 scripts/azure/provision-budget.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

BUDGET_NAME="${BUDGET_NAME:-jobops-monthly-30}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-30}"
DEPLOY_LOCATION="${DEPLOY_LOCATION:-eastus}"
BUDGET_EMAIL="${BUDGET_EMAIL:-}"

# Fail early with a clear message if not logged in.
az account show -o none

START_DATE="$(date +%Y-%m-01)"

if [[ -n "$BUDGET_EMAIL" ]]; then
  EMAILS_JSON="[\"${BUDGET_EMAIL}\"]"
else
  EMAILS_JSON="[]"
fi

TEMPLATE="$(dirname "$0")/budget-template.json"

echo "Deploying budget '$BUDGET_NAME' (\$$BUDGET_AMOUNT/mo, start $START_DATE) ..." >&2
az deployment sub create \
  --name "jobops-budget-deploy" \
  --location "$DEPLOY_LOCATION" \
  --template-file "$TEMPLATE" \
  --parameters \
      budgetName="$BUDGET_NAME" \
      amount="$BUDGET_AMOUNT" \
      startDate="$START_DATE" \
      contactEmails="$EMAILS_JSON" \
  -o none

echo "Budget '$BUDGET_NAME' set: alerts at 50/80/100% (actual) + 100% (forecast)." >&2
if [[ -n "$BUDGET_EMAIL" ]]; then
  echo "Alerts go to: $BUDGET_EMAIL and the subscription Owner role." >&2
else
  echo "Alerts go to the subscription Owner role (set BUDGET_EMAIL=you@example.com to also email a specific inbox)." >&2
fi
