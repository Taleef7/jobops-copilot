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

- `SCM_DO_BUILD_DURING_DEPLOYMENT=true` on both apps so App Service installs dependencies and runs the workspace build during deployment
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

Recommended workflow:

- run the manual Azure deployment workflow from the Actions tab
- deploy the web app and API together after `npm run build:web` and `npm run build:api` pass
- switch to push-based deployment later only after the App Service settings are stable

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
