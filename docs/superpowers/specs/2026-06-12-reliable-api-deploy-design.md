# Reliable API deploy (CI/CD) — design

## Problem

The API has no dependable automated deploy. The combined manual workflow
(`.github/workflows/azure-app-service.yml`) deploys the API with
`package: apps/api`, but `apps/api` is an npm **workspace** whose dependencies are
**hoisted to the repo-root `node_modules`**. The deployed folder therefore has no
real `node_modules`, so the running app crashes at startup with
`Cannot find module '@clerk/express'` (and the other prod deps), returning 503.

The proven manual workaround is to assemble a **self-contained** package
(`dist` + `package.json` + a local `npm install --omit=dev`) and zipdeploy that.
This design encodes that workaround as a first-class, automated workflow and adds a
post-deploy health-check gate so a broken deploy fails loudly instead of silently
leaving a crashed app.

## Goals

- A reliable, repeatable API deploy that ships all production dependencies.
- Auto-deploy on merge to `main` when API code changes, plus manual dispatch.
- A post-deploy smoke test that fails the run if the live API is unhealthy.
- One canonical API deploy path (remove the divergent, broken one).

## Non-goals

- No change to the web deploy (`deploy-web.yml` already works) or the agent
  (containerized via `services/agent/Dockerfile` → ACR → Container Apps).
- No change to hosting model: the API stays on Azure App Service (code/package
  deploy), not containers.
- The workflow does **not** manage Azure app settings or run `az login`. It deploys
  with a publish profile only. Required app settings are treated as preconditions.

## Approach

Mirror the existing `deploy-web.yml` pattern with a dedicated
`.github/workflows/deploy-api.yml`, and remove the `api` target from the combined
manual workflow so there is a single source of truth.

### New file: `.github/workflows/deploy-api.yml`

**Triggers**

- `push` to `main` on paths `apps/api/**` and `.github/workflows/deploy-api.yml`.
- `workflow_dispatch` (manual re-deploy).

**Hardening / standards**

- `permissions: contents: read` (least privilege).
- `concurrency: { group: deploy-api, cancel-in-progress: false }` (no overlapping
  deploys; a queued deploy waits rather than cancelling a publish in flight).
- `timeout-minutes: 15` on the job.
- Actions pinned at major version: `actions/checkout@v4`, `actions/setup-node@v4`
  (npm cache), `azure/webapps-deploy@v3`.

**Steps**

1. `actions/checkout@v4`.
2. `actions/setup-node@v4` with `node-version: 22.x`, `cache: npm`.
3. `npm ci` (root — installs all workspaces from the committed lockfile).
4. `npm run build:api` → produces `apps/api/dist` (tsc + tsc-alias).
5. Assemble the self-contained package in `apps/api/.deploy/` (the leading dot
   keeps it under the existing `.deploy/` `.gitignore` entry):
   - copy `apps/api/dist` → `apps/api/.deploy/dist`
   - copy `apps/api/package.json` → `apps/api/.deploy/package.json`
   - copy the repo-root `package-lock.json` into the deploy dir and run
     `npm ci --omit=dev` so the packaged versions match the lockfile exactly
     (deterministic) and get a real, un-hoisted `node_modules` with the prod deps.
6. Deploy with `azure/webapps-deploy@v3`:
   - `app-name: ${{ vars.AZURE_WEBAPP_NAME_API }}`
   - `publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE_API }}`
   - `package: apps/api/deploy`
7. Health-check gate: poll `https://${{ vars.AZURE_WEBAPP_NAME_API }}.azurewebsites.net/api/health`
   with a bounded retry loop (e.g. up to ~12 attempts, 15s apart ≈ 3 min). Pass when
   the response is HTTP 200 and the body contains `"mode":"postgres"`; otherwise
   print the last response and `exit 1`.

**Header comment — required preconditions (already set on `jobops-api`)**

- `WEBSITE_RUN_FROM_PACKAGE=1` (package mounted read-only — avoids the B1
  big-`node_modules` extraction hang).
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (no Oryx rebuild; we ship a built package).
- App secrets / Key Vault references / conn strings already configured.
- Repo config: var `AZURE_WEBAPP_NAME_API`, secret `AZURE_WEBAPP_PUBLISH_PROFILE_API`.

### Edit: `.github/workflows/azure-app-service.yml`

- Remove `api` from the `target` choice `options`.
- Remove the `Build API` and `Deploy API` steps.
- Add a comment pointing to `deploy-api.yml` as the canonical API deploy.
- Leave the web and agent targets unchanged.

### Docs

- `docs/AZURE_DEPLOYMENT.md`: name `deploy-api.yml` as the canonical, reliable API
  deploy; retire the "API path unreliable" caveat and the manual-zipdeploy
  workaround note (kept only as historical context if useful).

## Data flow

```
push to main (apps/api/**)  ─┐
workflow_dispatch           ─┴─►  deploy-api.yml
   checkout ─► npm ci ─► build:api ─► assemble apps/api/deploy
        (dist + package.json + npm install --omit=dev)
   ─► azure/webapps-deploy (publish profile, WEBSITE_RUN_FROM_PACKAGE=1)
   ─► GET /api/health  ── 200 & "mode":"postgres" ──► success
                        └─ otherwise ───────────────► fail (exit 1)
```

## Error handling

- **Missing prod dep at runtime** — root cause; eliminated by the self-contained
  `npm install --omit=dev` in the deploy dir.
- **Bad deploy reaches production** — caught by the health-check gate; the run goes
  red and surfaces the failing `/api/health` response.
- **Overlapping deploys** — prevented by the concurrency group.
- **Hung run** — bounded by `timeout-minutes` and the capped health-check retries.

## Testing / verification

Local (no Azure creds needed), proves the package is self-contained:

1. `npm ci && npm run build:api`
2. Assemble `apps/api/deploy` exactly as the workflow does.
3. From `apps/api/deploy`, run `node dist/server.js` and confirm it boots without a
   `Cannot find module` error (it will then try to bind/connect — module resolution
   succeeding is the signal we care about).
4. Lint the workflow YAML (`actionlint` if available; otherwise a YAML parse check).

Live: triggered by merging an `apps/api/**` change to `main` (or manual dispatch);
the health-check step is the automated acceptance test.

## Reproducibility note

The deploy install copies the repo-root `package-lock.json` into the assembled
directory and runs `npm ci --omit=dev`, so the packaged dependency versions are the
exact versions the lockfile pins (the same ones `npm ci` built and tested earlier in
the job) rather than a fresh semver re-resolve. Because npm hoists workspace
dependencies into a single lockfile, a few packages that belong to other workspaces
(e.g. `react`) are installed too; the API never imports them, so they are inert and
harmless under `WEBSITE_RUN_FROM_PACKAGE=1` (the package is mounted read-only).
