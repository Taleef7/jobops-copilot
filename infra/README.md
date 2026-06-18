# Infrastructure (Bicep) — Phase 5 · T

Infrastructure-as-code for the JobOps Copilot Azure footprint. This codifies what
[`scripts/azure/provision.sh`](../scripts/azure/provision.sh) does imperatively, so the
environment is reviewable, diffable, and reproducible.

## What it provisions

`main.bicep` (resource-group scoped) declares:

| Resource | Notes |
| --- | --- |
| App Service plan (Linux) | One `B1` plan hosting all three apps |
| `jobops-web` | Next.js dashboard (`NODE\|20-lts`) |
| `jobops-api` | Express API (`NODE\|20-lts`), `WEBSITE_RUN_FROM_PACKAGE=1` |
| `jobops-agent` | Python agent (`PYTHON\|3.12`) — code-deploy path; use the container for full RAG/torch |
| Log Analytics workspace | Backs workspace-based App Insights |
| Application Insights | Wired into every app via `APPLICATIONINSIGHTS_CONNECTION_STRING` |
| Postgres Flexible Server (v16) | `azure.extensions=VECTOR` for pgvector + an Allow-Azure-Services firewall rule |

Outputs: the three app URLs and the Postgres FQDN.

## Prerequisites

- Azure CLI (`az`) with the Bicep tooling (`az bicep install`).
- `az login` and a target resource group: `az group create -n jobops-rg -l eastus`.

## Validate (no Azure login required)

```bash
az bicep build --file infra/main.bicep        # compiles to ARM; fails on any error
az bicep build-params --file infra/main.bicepparam
```

This is what CI runs (the `infra` job in `.github/workflows/ci.yml`).

## Preview & deploy

Always preview against an existing environment before applying — a changed Postgres
SKU/password can be disruptive:

```bash
# Preview the diff
az deployment group what-if -g jobops-rg -f infra/main.bicep -p infra/main.bicepparam

# Apply (pass secrets at the CLI — never commit them)
az deployment group create -g jobops-rg -f infra/main.bicep -p infra/main.bicepparam \
  -p postgresAdminPassword="$PG_PW" databaseUrl="$DATABASE_URL" openAiApiKey="$OPENAI_API_KEY"
```

### Secrets

`postgresAdminPassword`, `databaseUrl`, and the provider keys are `@secure()` params with
blank defaults. Supply them at deploy time via CLI `-p` overrides (above) or, preferably,
[Key Vault references](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references)
so the App Service reads them from a vault rather than plaintext app settings.

## Relationship to the deploy workflows

This Bicep provisions the **infrastructure**. Application **code** is shipped separately by
`.github/workflows/deploy-api.yml`, `deploy-web.yml`, and `azure-app-service.yml`
(publish-profile based). After provisioning, run those, then bootstrap the schema:
`npm run db:init --workspace @jobops/api`.

> This file models desired state. It is authored and `az bicep build`-validated in CI, but
> deploying it against the live environment requires Azure credentials and a `what-if`
> review — that step is intentionally manual.
