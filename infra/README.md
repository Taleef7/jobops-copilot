# Infrastructure (Bicep) — Phase 5 · T

Infrastructure-as-code for the JobOps Copilot Azure footprint. It models the **actual
deployed topology** (reconciled + verified 2026-07-25 via `az deployment group what-if`
against RG `projects`), so the environment is reviewable, diffable, and reproducible.

The template is now a **faithful** model: against the live RG a `what-if` shows **no creates
and zero app-setting or secret deletions** on `jobops-web` / `jobops-api`. Every live app
setting is present; each App Service has a system-assigned identity and resolves
`DATABASE_URL` / `CLERK_SECRET_KEY` via Key Vault references; and the agent's real secrets,
env, registry, resources (1 vCPU / 2 GiB), and `/health` probes are modeled. The vault's
*secrets* and the apps' *role assignments* already exist on live (provisioned by
`scripts/azure/provision-keyvault.sh`), so they're gated behind `wireKeyVault` (default
false) — creating them against live would fail `RoleAssignmentExists` or blank a live
secret. A greenfield vault sets `wireKeyVault=true` to have the template create both.

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
| Key Vault (`jobops-kv`) | eastus | RBAC-authorized. The web/api resolve `DATABASE_URL` / `CLERK_SECRET_KEY` via `@Microsoft.KeyVault(...)` references — **now modeled here**: each App Service gets a system-assigned identity + a *Key Vault Secrets User* role assignment on the vault, and those two settings are references (no secret value flows through the template, so a deploy can't blank them) |
| Postgres Flexible Server (v16) | mexicocentral | `azure.extensions=vector` (pgvector) + Allow-Azure-Services firewall. **Opt-in** via `createPostgres` (default `false`) — see below |

Outputs: the web/api/agent URLs and (when created) the Postgres FQDN.

> **Not managed here:** the agent's container registry *resource* (auto-named ACR) and the
> image build/push are handled by the container pipeline (`az containerapp up` / a deploy
> workflow), not this template — `agentImage` just selects an already-published tag, and a
> `what-if` lists the ACR (and the existing Postgres when `createPostgres=false`) under
> *Ignore*. The agent's *pull auth* (admin-credential registry entry + password secret) **is**
> modeled so a deploy doesn't strip it; supply `acrAdminPassword` at deploy time.

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

A `what-if` against RG `projects` (verified 2026-07-25, `wireKeyVault=false`) shows **no
creates and no app-setting or secret deletions** on `jobops-web` / `jobops-api` — the
reconcile's goal. The only diffs are Azure-**computed** properties on the agent / its
environment / the plan (`runningStatus`, `ingress.traffic`, `workloadProfiles`,
`freeOfferExpirationTime`, …) that ARM recomputes, plus an env array re-ordering on the
agent (same variables). The ACR and existing Postgres are under *Ignore*. (App Service
secret *values* are write-only to ARM, so what-if can't show a blank-param diff — the
secret contract below still governs a real deploy.)

### Secrets — the deploy contract

App Service `appSettings` and Container App `secrets` are **REPLACE, not merge**: a blank
`@secure()` param blanks the live secret on deploy. Two of them are safe by construction —
`DATABASE_URL` and `CLERK_SECRET_KEY` are
[Key Vault references](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references)
(`jobops-kv`, identities wired in-template), so no value flows through the deployment and
they can't be blanked. **Every other secret must be supplied at deploy time** (blank
defaults, committed blank in `main.bicepparam`):

`databaseUrl` (the agent's own `database-url` secret), `agentApiKey` (the shared API↔agent
key — blank here would disable agent auth), `n8nWebhookSecret`, `adzunaAppKey`,
`openAiApiKey`, `tavilyApiKey`, `langfuseSecretKey`, `acrAdminPassword`, and
`postgresAdminPassword` (greenfield only).

```bash
az deployment group create -g projects -f infra/main.bicep -p infra/main.bicepparam \
  -p databaseUrl="$DATABASE_URL" agentApiKey="$AGENT_API_KEY" openAiApiKey="$OPENAI_API_KEY" \
     tavilyApiKey="$TAVILY_API_KEY" langfuseSecretKey="$LANGFUSE_SECRET_KEY" \
     n8nWebhookSecret="$N8N_WEBHOOK_SECRET" adzunaAppKey="$ADZUNA_APP_KEY" \
     acrAdminPassword="$ACR_ADMIN_PASSWORD"
```

Because what-if can't diff write-only secret values, **always confirm the secret env vars
are exported before a real deploy** — the write-only-ness is why the `what-if` looks clean
even though a bare deploy would blank them. The role assignments require the deployer to
hold *User Access Administrator* / *Owner* on the vault scope.

## Relationship to the deploy workflows

This Bicep provisions the **infrastructure**. Application **code** is shipped separately by
`.github/workflows/deploy-api.yml`, `deploy-web.yml`, and `azure-app-service.yml`
(publish-profile based). After provisioning, run those, then bootstrap the schema:
`npm run db:init --workspace @jobops/api`.

> This file models desired state. It is authored and `az bicep build`-validated in CI, but
> deploying it against the live environment requires Azure credentials and a `what-if`
> review — that step is intentionally manual.
