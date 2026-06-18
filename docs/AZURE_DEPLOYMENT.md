# Azure Deployment

## Current State

Phase 6 is complete — the whole stack is live on Azure:

- Next.js dashboard on **Azure App Service** (https://jobops-web.azurewebsites.net)
- Express API on **Azure App Service**, running in `postgres` mode
  (https://jobops-api.azurewebsites.net/api/health)
- Python agent service on **Azure Container Apps** (consumption, scale-to-zero)
- **Azure Database for PostgreSQL** Flexible Server as the live store, full schema
  migrated including the `pgvector` embeddings store
- **Azure Blob Storage** for report exports
- **Azure Application Insights** (`jobops-insights` + Log Analytics `jobops-logs`,
  1 GB/day cap) instrumenting web, API, and agent
- **Azure Key Vault** (`jobops-kv`, RBAC) serving the App Service secrets as
  managed-identity references

This footprint is now codified as **Bicep infrastructure-as-code** in [`infra/`](../infra/)
(Phase 5 · T) — `what-if`-verified against the live `projects` resource group and validated in
CI (`az bicep build`). See [`infra/README.md`](../infra/README.md) for the topology,
`what-if`/deploy steps, and the Postgres opt-in flag. The imperative `scripts/azure/provision*.sh`
scripts remain as the break-glass / historical reference.

The provisioning steps below are retained as the repeatable record of how the stack
was stood up.

## Azure PostgreSQL Setup

When creating the Flexible Server, keep the configuration small and inexpensive:

- use an allowed region from the subscription policy
- choose the Burstable tier
- choose `Standard_B1ms`
- use `32 GiB` storage
- keep high availability disabled
- use PostgreSQL password authentication
- allow public access only from the current IP that needs to connect

The schema intentionally avoids `pgcrypto`, so UUIDs come from the application and seed scripts instead of a database extension.

## Bootstrap Steps

1. Create the server and note the endpoint.
2. Add the connection string to `apps/api/.env`.

```env
DATABASE_URL=postgresql://user:password@server.postgres.database.azure.com:5432/postgres?sslmode=require
```

3. Run the bootstrap script from the repo root.

```bash
npm run db:init --workspace @jobops/api
```

4. Start the API.

```bash
npm run dev:api
```

5. Verify that `GET /api/health` reports `mode: "postgres"`.

## Cost Controls

- Keep high availability off unless you truly need it.
- Keep storage small until the database grows.
- Stop the server when you are not actively using it.
- Do not add reserved capacity or extra replicas for this MVP.

## Deployment Notes

- Keep environment variables out of source control.
- Use `.env.example` locally and Azure application settings in hosted environments.
- Prefer structured JSON logs for API and workflow observability.
- Use the same database schema and seed files for local verification and cloud setup.

## App Service First Pass

For the first Azure hosting pass, use two Linux App Service web apps:

- one app for `apps/web`
- one app for `apps/api`

Why this route:

- each app already has a production `start` script
- each workspace tsconfig is self-contained, so App Service can build the app folder directly without relying on repo-root files
- the monorepo stays intact, so we do not need to rewrite the runtime for Functions yet
- GitHub Actions can build the workspace packages and deploy them with `azure/webapps-deploy@v3`
- the API build rewrites TypeScript path aliases after compilation, so `node dist/server.js` starts cleanly in App Service

Required app settings:

- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` and `WEBSITE_RUN_FROM_PACKAGE=1` on the API app: CI ships a pre-built, self-contained package (see `deploy-api.yml`), so App Service must not rebuild and instead mounts the package read-only
- `NEXT_PUBLIC_API_BASE_URL=https://<api-app>.azurewebsites.net` on the web app
- `DATABASE_URL=...` on the API app
- `API_PUBLIC_BASE_URL=https://<api-app>.azurewebsites.net` on the API app
- `AZURE_STORAGE_CONNECTION_STRING=...` on the API app
- `AZURE_STORAGE_CONTAINER_NAME=...` on the API app
- `N8N_WEBHOOK_SECRET=...` on the API app

Startup command:

- `npm start` on both apps so App Service launches the production script from each workspace package

Optional settings:

- `API_SHARED_SECRET=...` if you want to require a shared key for non-n8n mutating API calls
- `NEXT_PUBLIC_API_SHARED_SECRET=...` only if the browser client is intentionally configured to send that shared key

GitHub Actions inputs and secrets:

- `vars.AZURE_WEBAPP_NAME_WEB`
- `vars.AZURE_WEBAPP_NAME_API`
- `secrets.AZURE_WEBAPP_PUBLISH_PROFILE_WEB`
- `secrets.AZURE_WEBAPP_PUBLISH_PROFILE_API`

Deploy workflows (canonical):

- **API** — `.github/workflows/deploy-api.yml` runs on push to `main` under
  `apps/api/**` (and on manual dispatch). It builds the API, assembles a
  self-contained package (`dist` + `package.json` + a local `npm install --omit=dev`),
  deploys it, and gates on a `/api/health` check returning `"mode":"postgres"`.
- **Web** — `.github/workflows/deploy-web.yml` runs on push to `main` under
  `apps/web/**` (and on manual dispatch), deploying the Next.js standalone bundle.
- **Agent** — containerized: build `services/agent/Dockerfile`, push to ACR, then
  `az containerapp update`. The `azure-app-service.yml` agent target is a code-deploy
  fallback for a no-RAG agent only.

## Recommended Phase 6 Order

1. Deploy the Next.js dashboard to Azure Static Web Apps or another Azure web host.
2. Deploy the Express API to Azure Functions or another Azure API host.
3. Connect Azure Blob Storage for report exports and any future uploaded artifacts.
4. Copy the required environment variables into Azure application settings or Key Vault.
5. Add Azure Application Insights so the hosted stack has basic tracing and error visibility.
6. Capture deployment screenshots once the public or semi-public stack is live.

## Recommendation

For the first pass, keep the deployment small and auditable:

- deploy the dashboard first so the UI has a stable public URL
- keep the API and database as the next cut so the live data path stays consistent
- wire Blob Storage only after the app and API URLs are stable
- avoid adding extra Azure services until the core hosting path is verified

## Progress Notes

- The Azure database layer is verified and live.
- Full hosting for the web and API applications is still to come.
- The repo now includes a repeatable bootstrap script so the cloud database can be recreated without manual SQL copy-paste.

## Cost controls

The deployment runs on an Azure for Students subscription with a $100 credit cap.
Two local operator tools help avoid surprise spend — both act only via your own
`az login` session, commit no secrets, and are never run from CI.

### Budget alerts

`scripts/azure/provision-budget.sh` creates a monthly Cost Management budget that
**emails alerts** at 50/80/100% (actual) and 100% (forecast). It only alerts — it does
not cap or stop anything.

```bash
az login
scripts/azure/provision-budget.sh                                  # $30/mo, emails your signed-in account
BUDGET_EMAIL=you@example.com scripts/azure/provision-budget.sh      # send alerts to a specific inbox instead
```

By default the alerts go to the email of your signed-in `az` account (read at runtime,
never committed) plus the subscription Owner role; pass `BUDGET_EMAIL` to use a
different inbox. A subscription-scope budget **requires at least one contact email**, so
if none can be derived from your session the script asks you to set `BUDGET_EMAIL`.
Override `BUDGET_AMOUNT` / `BUDGET_NAME` via env vars; re-running updates the same budget
in place. Requires Cost Management Contributor or Owner on the subscription. If the
Consumption API is unavailable for the offer, create it in the portal instead
(Cost Management → Budgets).

### Pause / resume the baseline

`scripts/azure/lifecycle.sh` stops/starts the chargeable baseline for stretches when
you are not using the stack:

```bash
scripts/azure/lifecycle.sh pause    # stop Postgres + scale the agent to zero
scripts/azure/lifecycle.sh status   # show Postgres state + agent min-replicas
scripts/azure/lifecycle.sh resume   # start Postgres back up
```

Caveats:

- **While paused, the live site's database features do not work** — `resume` first.
- **Azure auto-restarts a stopped Flexible Server after ~7 days** — re-run `pause` for
  longer breaks.
- **The App Service B1 plan (~$13/mo) keeps billing while paused.** Stopping the apps
  does not reduce the plan charge. To go fully to ~$0 you must either downgrade the plan
  to Free (`az appservice plan update -g projects -n jobops-plan --sku F1` — Free has
  real limits: no always-on, reduced quotas, no custom-domain TLS) or delete the plan
  (destructive). These are manual, opt-in steps; the script does not do them.

`cool` vs `pause`: `demo.sh cool` only sleeps the agent (demo cost); `lifecycle.sh
pause` sleeps the whole baseline (DB + agent) for longer idle periods.

## Monitoring & alerts

Application Insights (`jobops-insights`) collects telemetry from web, API, and agent.
`scripts/azure/provision-monitoring.sh` makes that telemetry actionable — an email action
group, two failure alerts, and a portal dashboard. Local tool: acts only via your
`az login`, commits no secrets, never run from CI.

```bash
az login
scripts/azure/provision-monitoring.sh                              # emails your signed-in account
ALERT_EMAIL=you@example.com scripts/azure/provision-monitoring.sh   # send alerts to a specific inbox
```

**Alerts** (Azure Monitor metric alerts on the component, severity 2, emailed via the
`jobops-alerts` action group):

- `jobops-failed-requests` — 5+ failed HTTP requests in 5 minutes.
- `jobops-server-exceptions` — 5+ server exceptions in 5 minutes.

Both are failure-count based, so they stay quiet when the app is idle or `pause`d (no
traffic → no failures → no alert). There is deliberately **no latency alert** (the AI
endpoints make real LLM calls that are legitimately slow) and **no uptime ping** (it would
false-fire while intentionally paused). Response time is shown on the dashboard instead.

**Dashboard** `jobops-monitoring` (Azure portal → Dashboard) shows four tiles: requests,
failed requests, server response time, and server exceptions.

Re-running updates everything in place. Requires Monitoring Contributor (or Owner) on the
resource group. Cost is ~$0.20/mo (two alert rules; the action group and dashboard are
free).
