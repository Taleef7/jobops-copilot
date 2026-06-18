# Infrastructure (Bicep) — Phase 5 · T

Infrastructure-as-code for the JobOps Copilot Azure footprint. It models the **actual
deployed topology** (verified 2026-06-18 via `az deployment group what-if` against RG
`projects`), so the environment is reviewable, diffable, and reproducible.

## What it provisions

`main.bicep` (resource-group scoped). Resources legitimately span **two regions**, so
locations are split across `appLocation` (default `mexicocentral`) and `platformLocation`
(default `eastus`):

| Resource | Region | Notes |
| --- | --- | --- |
| App Service plan (Linux, `B1`) | mexicocentral | Hosts the web + api App Services |
| `jobops-web` | mexicocentral | Next.js dashboard (`NODE\|22-lts`) |
| `jobops-api` | mexicocentral | Express API (`NODE\|22-lts`), `WEBSITE_RUN_FROM_PACKAGE=1` |
| `jobops-agent` + `jobops-agent-env` | eastus | **Container App** (port 8000, external, scale 0–3) on a Container Apps managed environment — `agentImage` points at the ACR tag the container pipeline pushes |
| Log Analytics + Application Insights | eastus | Workspace-based; wired into web/api/agent via `APPLICATIONINSIGHTS_CONNECTION_STRING` |
| Key Vault (`jobops-kv`) | eastus | RBAC-authorized, provisioned for future Key Vault-referenced secrets (not yet wired as a secret source — apps still take plaintext settings today) |
| Postgres Flexible Server (v16) | mexicocentral | `azure.extensions=vector` (pgvector) + Allow-Azure-Services firewall. **Opt-in** via `createPostgres` (default `false`) — see below |

Outputs: the web/api/agent URLs and (when created) the Postgres FQDN.

> **Not managed here:** the agent's container registry (auto-named ACR) and image build/push
> are handled by the container pipeline (`az containerapp up` / a deploy workflow), not this
> template — `agentImage` just selects an already-published tag. A `what-if` correctly lists
> the ACR (and the existing Postgres when `createPostgres=false`) under *Ignore*.

### Postgres is opt-in

`createPostgres` defaults to **`false`** so a deploy never reconciles the **existing
production server** (`jobops`) — its admin password, SKU, and storage would otherwise be
rewritten. The default deploy provisions the App Service + observability tier only and
leaves the live database untouched. Set `createPostgres=true` (and supply
`postgresAdminPassword`) for a greenfield environment.

> **Greenfield note:** a Container Apps managed environment is slow to provision; on a
> first `create` the `jobops-agent` container app depends on `jobops-agent-env` reaching a
> ready state. ARM handles the ordering via the implicit dependency, but expect the
> environment step to take several minutes.

The App Service apps set `ftpsState: Disabled` / `minTlsVersion: 1.2` as hardening; the
deploy workflows publish over SCM/zip (not FTP), so this doesn't affect them.

## Prerequisites

- Azure CLI (`az`) with the Bicep tooling (`az bicep install`).
- `az login`. The live environment is RG `projects`; for a greenfield deploy create your own
  RG: `az group create -n <rg> -l mexicocentral`.

## Validate (no Azure login required)

```bash
az bicep build --file infra/main.bicep        # compiles to ARM; fails on any error
az bicep build-params --file infra/main.bicepparam
```

This is what CI runs (the `infra` job in `.github/workflows/ci.yml`).

## Preview & deploy

Always preview against an existing environment before applying — a `what-if` is
non-destructive and the authoritative fidelity check:

```bash
# Preview the diff against the live environment (read-only)
az deployment group what-if -g projects -f infra/main.bicep -p infra/main.bicepparam

# Apply (pass secrets at the CLI — never commit them)
az deployment group create -g projects -f infra/main.bicep -p infra/main.bicepparam \
  -p databaseUrl="$DATABASE_URL" openAiApiKey="$OPENAI_API_KEY"
```

A `what-if` against RG `projects` (verified 2026-06-18) lists all eight templated resources
as present (web, api, plan, agent, agent-env, insights, logs, kv) — no spurious creates or
deletes — with the ACR and existing Postgres correctly under *Ignore*.

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
