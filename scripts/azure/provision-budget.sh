#!/usr/bin/env bash
# Provision a monthly Cost Management budget for the JobOps subscription, with
# alerts at 50/80/100% (actual) and 100% (forecast). Subscription-scope budget
# notifications REQUIRE at least one contact email (contactRoles alone is rejected
# by the Microsoft.Consumption/budgets schema), so by default we use the signed-in
# operator's own email (read at runtime, never committed) and also notify the
# Owner role. Override the recipient with BUDGET_EMAIL.
#
# SECURITY: local operator tool — never run from CI. Authority is your own
# `az login` session. No secrets/IDs are committed; the contact email is read from
# your live `az` session (or BUDGET_EMAIL) at deploy time and never written to the repo.
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

# A subscription-scope budget requires at least one contact email. Default to the
# signed-in account's email (its UPN); fall back to a clear instruction otherwise.
if [[ -z "$BUDGET_EMAIL" ]]; then
  BUDGET_EMAIL="$(az account show --query user.name -o tsv 2>/dev/null || true)"
fi
if [[ -z "$BUDGET_EMAIL" || "$BUDGET_EMAIL" != *@*.* ]]; then
  echo "ERROR: a notification email is required — subscription budgets reject empty contacts." >&2
  echo "Could not derive one from your az session; re-run with BUDGET_EMAIL=you@example.com" >&2
  exit 1
fi
EMAILS_JSON="[\"${BUDGET_EMAIL}\"]"

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
echo "Alerts go to: $BUDGET_EMAIL (and the subscription Owner role)." >&2
