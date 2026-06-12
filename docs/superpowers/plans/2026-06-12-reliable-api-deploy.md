# Reliable API Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `apps/api` deploy with a dedicated, push-triggered GitHub Actions workflow that ships a self-contained package and verifies the live API is healthy.

**Architecture:** A new `deploy-api.yml` (mirroring `deploy-web.yml`) builds the API, assembles a self-contained `apps/api/.deploy` directory (`dist` + `package.json` + a local `npm install --omit=dev` so prod deps are no longer hoisted away), deploys it via `azure/webapps-deploy@v3`, then polls `/api/health`. The `api` target is removed from the combined `azure-app-service.yml` so there is one canonical path.

**Tech Stack:** GitHub Actions, Node 22, npm workspaces, Azure App Service (`azure/webapps-deploy@v3`), publish-profile auth.

**Spec:** `docs/superpowers/specs/2026-06-12-reliable-api-deploy-design.md`

---

## File Structure

- **Create** `.github/workflows/deploy-api.yml` — canonical API deploy (push + dispatch, assemble, deploy, health check).
- **Modify** `.github/workflows/azure-app-service.yml` — drop the `api` (and now-redundant `both`) target; leave web/agent.
- **Modify** `docs/AZURE_DEPLOYMENT.md` — name the two dedicated workflows as canonical; correct the stale `SCM_DO_BUILD_DURING_DEPLOYMENT=true` note for the API.
- **Scratch (not committed)** `apps/api/.deploy/` — the assembled package; already covered by the `.deploy/` entry in `.gitignore`.

---

## Task 1: Prove the self-contained assembly recipe locally

This is the acceptance test for the workflow logic: confirm that assembling
`dist` + `package.json` + a local prod install yields a package where every
production dependency resolves. Run from the repo root in **Git Bash**.

**Files:** none committed (verification only).

- [ ] **Step 1: Build the API**

Run:
```bash
npm ci
npm run build:api
```
Expected: completes; `apps/api/dist/server.js` exists.

- [ ] **Step 2: Assemble the self-contained package exactly as the workflow will**

Run:
```bash
rm -rf apps/api/.deploy
mkdir -p apps/api/.deploy/dist
cp -r apps/api/dist/. apps/api/.deploy/dist/
cp apps/api/package.json apps/api/.deploy/package.json
( cd apps/api/.deploy && npm install --omit=dev --no-audit --no-fund )
```
Expected: install completes, `apps/api/.deploy/node_modules` is populated.

- [ ] **Step 3: Verify every prod dependency resolves from the package**

Run:
```bash
( cd apps/api/.deploy && node -e "const d=require('./package.json').dependencies||{};for(const k of Object.keys(d))require.resolve(k);console.log('OK:',Object.keys(d).length,'prod deps resolve');" )
```
Expected: prints `OK: 9 prod deps resolve` with no `MODULE_NOT_FOUND`. (This is the
exact failure the broken `package: apps/api` deploy hits — proving it passes here
proves the fix.)

- [ ] **Step 4: Clean up the scratch dir**

Run:
```bash
rm -rf apps/api/.deploy
```
Expected: removed. (No commit — this task only validates the recipe.)

---

## Task 2: Create the dedicated API deploy workflow

**Files:**
- Create: `.github/workflows/deploy-api.yml`

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/deploy-api.yml` with exactly:

```yaml
# Deploy the JobOps API to Azure App Service.
#
# Why this exists: apps/api is an npm workspace whose dependencies are hoisted to
# the repo-root node_modules. Deploying the workspace folder directly ships no
# node_modules, so the app crashes with "Cannot find module '@clerk/express'".
# This workflow assembles a SELF-CONTAINED package (dist + package.json + a local
# production install) and deploys that, then verifies the live app is healthy.
#
# Preconditions (already configured on the jobops-api App Service):
#   - App setting WEBSITE_RUN_FROM_PACKAGE=1        (package mounted read-only;
#     avoids the B1 big-node_modules extraction hang)
#   - App setting SCM_DO_BUILD_DURING_DEPLOYMENT=false  (no Oryx rebuild)
#   - DB / Clerk / App Insights secrets (or Key Vault references) set
# Repo config:
#   - Variable AZURE_WEBAPP_NAME_API
#   - Secret   AZURE_WEBAPP_PUBLISH_PROFILE_API
name: Deploy API (Azure)

on:
  push:
    branches: [main]
    paths:
      - 'apps/api/**'
      - '.github/workflows/deploy-api.yml'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-api
  cancel-in-progress: false

jobs:
  deploy:
    name: Build + deploy API
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build API
        run: npm run build:api

      - name: Assemble self-contained deploy package
        run: |
          set -euo pipefail
          rm -rf apps/api/.deploy
          mkdir -p apps/api/.deploy/dist
          cp -r apps/api/dist/. apps/api/.deploy/dist/
          cp apps/api/package.json apps/api/.deploy/package.json
          ( cd apps/api/.deploy && npm install --omit=dev --no-audit --no-fund )
          # Fail fast if any production dependency did not land in the package.
          ( cd apps/api/.deploy && node -e "const d=require('./package.json').dependencies||{};for(const k of Object.keys(d))require.resolve(k);console.log('OK:',Object.keys(d).length,'prod deps resolve');" )

      - name: Deploy to Azure App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ vars.AZURE_WEBAPP_NAME_API }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE_API }}
          package: apps/api/.deploy

      - name: Health check
        env:
          API_NAME: ${{ vars.AZURE_WEBAPP_NAME_API }}
        run: |
          set -euo pipefail
          url="https://${API_NAME}.azurewebsites.net/api/health"
          echo "Polling $url"
          for i in $(seq 1 12); do
            body="$(curl -fsS --max-time 10 "$url" || true)"
            echo "attempt $i: $body"
            if printf '%s' "$body" | grep -Eq '"mode"[[:space:]]*:[[:space:]]*"postgres"'; then
              echo "API healthy."
              exit 0
            fi
            sleep 15
          done
          echo "API did not report a healthy postgres mode in time." >&2
          exit 1
```

- [ ] **Step 2: Validate the YAML parses**

Run:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/deploy-api.yml','utf8');if(!/name: Deploy API/.test(s))throw new Error('header missing');console.log('workflow file present, header OK')"
```
Expected: prints `workflow file present, header OK`. (If `actionlint` is installed,
also run `actionlint .github/workflows/deploy-api.yml` and expect no errors.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-api.yml
git commit -m "ci: dedicated reliable API deploy (self-contained package + health check)"
```

---

## Task 3: Remove the API target from the combined workflow

Eliminate the second, broken API path so `deploy-api.yml` is canonical. The `both`
option (web+api) loses its meaning once API is gone, so drop it too.

**Files:**
- Modify: `.github/workflows/azure-app-service.yml`

- [ ] **Step 1: Trim the target choices**

In `.github/workflows/azure-app-service.yml`, replace:
```yaml
        options:
          - all
          - both
          - web
          - api
          - agent
```
with:
```yaml
        options:
          - all
          - web
          - agent
```

- [ ] **Step 2: Fix the web step conditions (drop `both`)**

Replace the web build condition:
```yaml
        if: ${{ inputs.target == 'all' || inputs.target == 'both' || inputs.target == 'web' }}
        run: npm run build:web
```
with:
```yaml
        if: ${{ inputs.target == 'all' || inputs.target == 'web' }}
        run: npm run build:web
```

And replace the web deploy condition (the `if:` line directly above `uses: azure/webapps-deploy@v3` for `AZURE_WEBAPP_NAME_WEB`):
```yaml
        if: ${{ inputs.target == 'all' || inputs.target == 'both' || inputs.target == 'web' }}
```
with:
```yaml
        if: ${{ inputs.target == 'all' || inputs.target == 'web' }}
```

- [ ] **Step 3: Delete the Build API and Deploy API steps**

Remove these two steps entirely:
```yaml
      - name: Build API
        if: ${{ inputs.target == 'all' || inputs.target == 'both' || inputs.target == 'api' }}
        run: npm run build:api
```
and
```yaml
      - name: Deploy API
        if: ${{ inputs.target == 'all' || inputs.target == 'both' || inputs.target == 'api' }}
        uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ vars.AZURE_WEBAPP_NAME_API }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE_API }}
          package: apps/api # workspace package root; tsconfig is self-contained
```

- [ ] **Step 4: Add a pointer comment above the `Deploy web app` step**

Insert this comment line immediately before the `- name: Deploy web app` step:
```yaml
      # API deploys live in deploy-api.yml (push-triggered + dispatch). This
      # combined workflow covers web and the code-deploy agent path only.
```

- [ ] **Step 5: Validate the YAML parses and no API target remains**

Run:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/azure-app-service.yml','utf8');if(/- api\b/.test(s))throw new Error('api target still present');if(/Deploy API/.test(s))throw new Error('Deploy API step still present');console.log('combined workflow trimmed OK')"
```
Expected: prints `combined workflow trimmed OK`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/azure-app-service.yml
git commit -m "ci: make deploy-api.yml the single API deploy path (drop api target from combined workflow)"
```

---

## Task 4: Correct the deployment docs

**Files:**
- Modify: `docs/AZURE_DEPLOYMENT.md`

- [ ] **Step 1: Fix the stale API app-setting note**

In `docs/AZURE_DEPLOYMENT.md`, replace:
```markdown
- `SCM_DO_BUILD_DURING_DEPLOYMENT=true` on both apps so App Service installs dependencies and runs the workspace build during deployment
```
with:
```markdown
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` and `WEBSITE_RUN_FROM_PACKAGE=1` on the API app: CI ships a pre-built, self-contained package (see `deploy-api.yml`), so App Service must not rebuild and instead mounts the package read-only
```

- [ ] **Step 2: Replace the "Recommended workflow" bullets with the canonical paths**

Replace:
```markdown
Recommended workflow:

- run the manual Azure deployment workflow from the Actions tab
- deploy the web app and API together after `npm run build:web` and `npm run build:api` pass
- switch to push-based deployment later only after the App Service settings are stable
```
with:
```markdown
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
```

- [ ] **Step 3: Verify the edits landed**

Run:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('docs/AZURE_DEPLOYMENT.md','utf8');if(/SCM_DO_BUILD_DURING_DEPLOYMENT=true/.test(s))throw new Error('stale =true note remains');if(!/deploy-api.yml/.test(s))throw new Error('canonical path not documented');console.log('docs updated OK')"
```
Expected: prints `docs updated OK`.

- [ ] **Step 4: Commit**

```bash
git add docs/AZURE_DEPLOYMENT.md
git commit -m "docs: document deploy-api.yml as the canonical API deploy path"
```

---

## Task 5: Open the PR (do not merge)

**Files:** none.

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin reliable-api-deploy
```

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "ci: reliable API deploy (self-contained package + health check)" --body "<summary: root cause = hoisted workspace deps; fix = self-contained apps/api/.deploy package; new deploy-api.yml push+dispatch with /api/health gate; api target removed from combined workflow; docs corrected. Local verification: 9 prod deps resolve from the assembled package.>"
```
Expected: PR URL printed. Do **not** merge — the maintainer merges. The live deploy
is exercised when the PR merges to `main` (the health-check step is the automated
acceptance test); a manual `workflow_dispatch` run can validate sooner.

---

## Self-review notes

- **Spec coverage:** self-contained package (Task 1 proves it, Task 2 encodes it);
  push + dispatch triggers (Task 2); health-check gate (Task 2); single canonical
  path / remove api target (Task 3); docs hygiene (Task 4); preconditions documented
  in the workflow header (Task 2) and corrected in AZURE_DEPLOYMENT.md (Task 4);
  reproducibility trade-off noted in the spec (no code impact).
- **Assembly dir name** is `apps/api/.deploy` so it is already covered by the
  `.deploy/` entry in `.gitignore` — no gitignore change needed.
- **Health-check match** tolerates whitespace (`"mode"[[:space:]]*:[[:space:]]*"postgres"`),
  matching the real `/api/health` JSON.
- **No app-settings management** in the workflow (publish-profile only, no `az login`);
  the required settings are documented preconditions, already set on `jobops-api`.
