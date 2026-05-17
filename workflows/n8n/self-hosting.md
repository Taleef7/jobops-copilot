# n8n Self-Hosting Guide

This is the cheapest practical way to use the Phase 4 n8n workflows. Start
locally first so you can learn the editor without paying for n8n Cloud.

## What This Setup Assumes

- You are on Windows with Docker Desktop installed.
- JobOps Copilot is running locally from this repo.
- The API is reachable on `http://localhost:4000`.
- You want to run n8n locally on `http://localhost:5678`.

## Why This Is The Right First Step

- It is free aside from your own machine.
- It keeps the current workflow exports usable without rebuilding them.
- It lets you test the weekly report and reminder flows before you think about
  public hosting.
- It avoids the biggest beginner trap: trying to learn n8n and hosting at the
  same time.

## Step 1. Start The JobOps API

From the repo root:

```bash
npm install
npm run dev:api
```

Keep that terminal open. The API should listen on port `4000`.

If you want to check it quickly, open:

- `http://localhost:4000/health`

## Step 2. Pick A Shared Secret

The API and n8n need the same webhook secret.

Use any long random string. A simple PowerShell way to create one is:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Copy the result somewhere safe. You will use it in two places:

- `N8N_WEBHOOK_SECRET` in `apps/api/.env`
- `N8N_WEBHOOK_SECRET` in the n8n container environment

The API workspace loads its local `.env` file through `dotenv/config`, so
`apps/api/.env` is the file to edit when you start the API with
`npm run dev:api`.

## Step 3. Create A Local n8n Compose File

The repo includes a ready-to-run Compose file and an example env file:

- [compose.yaml](./compose.yaml)
- [.env.example](./.env.example)

Copy `.env.example` to `.env`, replace the secret, and keep both files in the
same folder as `compose.yaml`.

The important value is `N8N_WEBHOOK_SECRET`. Keep it identical to the value in
the JobOps API environment.

## Step 4. Start n8n

From the folder that contains `compose.yaml`:

```bash
docker compose up -d
```

Then open:

- `http://localhost:5678`

Create the initial n8n owner account when prompted.

## Step 5. Import The First Workflow

Start with the weekly report workflow because it is the simplest test.

Import:

- `workflows/n8n/exports/weekly-report.workflow.json`

Then check the HTTP Request node and confirm:

- the URL points to the JobOps API
- the `X-N8N-Webhook-Secret` header is set

Run the workflow manually. You should get a response that includes the weekly
report draft fields from the API.

## Step 6. Add The Other Workflows

After the weekly report works, import:

- `workflows/n8n/exports/follow-up-reminders.workflow.json`
- `workflows/n8n/exports/job-intake.workflow.json`

Recommended order:

1. weekly report
2. follow-up reminders
3. job intake

That order keeps the setup easy to debug.

## Step 7. Verify The Most Common Failure Points

If something fails, check these first:

- `JOBOPS_API_BASE_URL` must point to the host API, not `localhost` inside the
  container.
- `N8N_WEBHOOK_SECRET` must match exactly in both places.
- `WEBHOOK_URL` should stay on `http://localhost:5678/` for local testing.
- The JobOps API must already be running before n8n calls it.
- Docker Desktop must still be running in the background.

## If You Move Beyond Local Testing

When you later host n8n on a VPS or expose it through a reverse proxy, update
these values:

- `WEBHOOK_URL` to the public n8n URL
- `N8N_EDITOR_BASE_URL` to the public editor URL
- `N8N_PROXY_HOPS=1` if you are behind a reverse proxy

Keep `JOBOPS_API_BASE_URL` pointed at whatever API host the workflows should
call.

## My Recommendation

For your first pass:

- keep n8n local
- use the weekly report workflow first
- leave Gmail and other side integrations out until the basic API round-trip
  works
- only move to public hosting after the local setup feels comfortable
