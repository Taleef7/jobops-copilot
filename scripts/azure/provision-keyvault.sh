#!/usr/bin/env bash
# Provision Key Vault (RBAC mode) and grant:
#  - the signed-in deployer "Key Vault Secrets Officer" (so `secret set` works),
#  - the web + API App Service managed identities "Key Vault Secrets User" (read).
# No app code change; app settings are switched to Key Vault references separately.
set -euo pipefail

# On Windows Git Bash, stop MSYS from rewriting the ARM resource id (/subscriptions/...)
# into a C:\ path when passed to --scope. No-op elsewhere.
export MSYS_NO_PATHCONV=1

RG="${RG:-projects}"
LOCATION="${LOCATION:-eastus}"
VAULT="${VAULT:-jobops-kv}"

# Fail early with a clear message if not logged in.
az account show -o none

# Ensure the Key Vault resource provider is registered (idempotent; --wait blocks
# until Registered). Azure-for-Students subscriptions often start unregistered.
az provider register --namespace Microsoft.KeyVault --wait

# Create only if absent (`az keyvault create` errors on a pre-existing vault).
if ! az keyvault show --name "$VAULT" --resource-group "$RG" -o none 2>/dev/null; then
  az keyvault create \
    --name "$VAULT" --resource-group "$RG" --location "$LOCATION" \
    --enable-rbac-authorization true
fi

KV_ID=$(az keyvault show --name "$VAULT" --resource-group "$RG" --query id -o tsv)

# Deployer (current signed-in user) needs a data-plane role to manage secrets.
# RBAC mode rejects secret writes from Owner/Contributor alone.
# Derive the object id from the access-token `oid` claim instead of calling
# Microsoft Graph (`az ad signed-in-user show`) — Graph tokens go stale on this
# subscription (recurring invalid_grant) even right after `az login`.
CALLER_OID=$(az account get-access-token --query accessToken -o tsv \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=d.trim().split('.')[1].replace(/-/g,'+').replace(/_/g,'/');process.stdout.write(JSON.parse(Buffer.from(p,'base64').toString()).oid)})")
az role assignment create \
  --assignee-object-id "$CALLER_OID" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" --scope "$KV_ID"

# Grant each App Service's system-assigned identity read access to secrets.
for APP in jobops-api jobops-web; do
  az webapp identity assign --resource-group "$RG" --name "$APP"
  PID=$(az webapp identity show --resource-group "$RG" --name "$APP" --query principalId -o tsv)
  az role assignment create \
    --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Secrets User" --scope "$KV_ID"
done

echo "Key Vault $VAULT ready. Vault URI:"
az keyvault show --name "$VAULT" --resource-group "$RG" --query properties.vaultUri -o tsv
