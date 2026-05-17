# Azure Deployment

## Current State

The Azure PostgreSQL portion of the deployment is already working. The repository currently uses Azure Database for PostgreSQL Flexible Server as the live cloud database path when `DATABASE_URL` is set.

The remaining Azure hosting work is still future scope:

- Azure Static Web Apps or another web host for the Next.js dashboard
- Azure Functions or another API host for the Express API
- Azure Blob Storage for resumes, snapshots, and generated reports
- Azure Application Insights for monitoring and tracing
- Azure Key Vault for secrets

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

## Progress Notes

- The Azure database layer is verified and live.
- Full hosting for the web and API applications is still to come.
- The repo now includes a repeatable bootstrap script so the cloud database can be recreated without manual SQL copy-paste.
