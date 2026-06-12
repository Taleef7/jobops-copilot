# Live demo runbook + agent warm-up — design

## Problem

The deployed stack is cheap-at-idle by design, which makes live demos fragile:

- The Python agent runs on **Azure Container Apps with `min-replicas=0`** (scale-to-zero,
  ~$0 idle). The first request after idle is a cold start, so an unwarmed live demo
  looks broken (the AI features fall back to the deterministic mock).
- A **hybrid demo** (local dev servers against the cloud Postgres) needs the current
  client IP allow-listed on the Postgres firewall; IPs change, so this is re-done often.

Today both are manual, ad-hoc `az` commands recalled from memory mid-demo. We want one
idempotent, health-gated operator script plus a short runbook so a demo is a two-command
ritual: warm, present, cool.

## Goals

- One command to make the live stack demo-ready and confirm it (agent warm, DB
  reachable, all health endpoints green).
- One command to return to the cheap idle state afterward.
- A read-only status command to check readiness anytime.
- A runbook in `docs/DEMO.md` for the live (cloud) path, complementing the existing
  local walkthrough.
- Safe to commit: no secrets, no attacker foothold (see Security).

## Non-goals

- No provisioning/deploys (that is `provision*.sh` and `deploy-*.yml`).
- No change to app code or the health endpoints (reuses the existing `/api/health/ready`).
- Not wired into CI or any automation that holds cloud credentials (see Security).

## Real deployment targets (not the idealized `provision.sh` defaults)

- Resource group **`projects`**.
- Agent: Container App **`jobops-agent`** (region `eastus`), scaled via
  `az containerapp update --min-replicas`.
- Web App Service **`jobops-web`**, API App Service **`jobops-api`**.
- Postgres Flexible Server **`jobops`** (firewall managed via
  `az postgres flexible-server firewall-rule`).

All of these are overridable via environment variables; the defaults are the real,
non-secret deployed names.

## Architecture

A single bash script `scripts/azure/demo.sh` (matches the existing `scripts/azure/*.sh`
convention), `set -euo pipefail`, dispatched by a subcommand: `warm` | `status` | `cool`.
Plus a "Live cloud demo" section appended to `docs/DEMO.md`.

### Config block (env-overridable, non-secret defaults)

```
RESOURCE_GROUP=${RESOURCE_GROUP:-projects}
AGENT_APP=${AGENT_APP:-jobops-agent}
WEB_APP=${WEB_APP:-jobops-web}
API_APP=${API_APP:-jobops-api}
PG_RESOURCE_GROUP=${PG_RESOURCE_GROUP:-projects}
PG_SERVER=${PG_SERVER:-jobops}
FIREWALL_RULE=${FIREWALL_RULE:-demo-warmup}
HEALTH_RETRIES=${HEALTH_RETRIES:-20}
HEALTH_INTERVAL=${HEALTH_INTERVAL:-15}
```

### Preflight (every subcommand)

- Require `az` and `curl` on PATH; fail with install hints if missing.
- `az account show` — if it fails, print "run: az login" and exit non-zero. (Tokens on
  this subscription expire often; failing early beats a confusing mid-command error.)

### Derived values

- Agent FQDN: `az containerapp show -g $RESOURCE_GROUP -n $AGENT_APP --query properties.configuration.ingress.fqdn -o tsv` → `AGENT_URL=https://<fqdn>`.
- Web/API URLs derived from the App Service default hostnames (or `https://<app>.azurewebsites.net`).

### `warm`

1. Scale the agent up: `az containerapp update -g $RESOURCE_GROUP -n $AGENT_APP --min-replicas 1 -o none`.
2. DB firewall upsert for the current IP:
   - `IP=$(curl -fsS --max-time 10 https://api.ipify.org)`.
   - Validate `IP` against an IPv4 regex; abort if it does not match (input hygiene).
   - `az postgres flexible-server firewall-rule create -g $PG_RESOURCE_GROUP -n $PG_SERVER --rule-name $FIREWALL_RULE --start-ip-address $IP --end-ip-address $IP -o none` (create is idempotent — same fixed rule name is updated in place, so rules never accumulate).
3. Health gate (`run_health_checks`, shared with `status`): poll until all green or retries exhausted:
   - Agent `GET $AGENT_URL/health` → HTTP 200.
   - API `GET https://<api>/api/health/ready` → body contains `"db":"ok"`.
   - Web `GET https://<web>/` → HTTP 200.
4. On success: print the live URLs and a reminder: "Run `demo.sh cool` after the demo
   (agent at min-replicas=1 bills ~$20–30/mo if left on)." On failure: exit non-zero
   naming the unhealthy endpoint.

### `status`

- Preflight + a single `run_health_checks` pass (no retry loop), read-only. Prints a
  per-endpoint ✓/✗ line and exits non-zero if any check fails. Makes no changes to Azure.

### `cool`

1. Scale the agent down: `az containerapp update -g $RESOURCE_GROUP -n $AGENT_APP --min-replicas 0 -o none`.
2. Remove the firewall rule: `az postgres flexible-server firewall-rule delete -g $PG_RESOURCE_GROUP -n $PG_SERVER --rule-name $FIREWALL_RULE --yes -o none` (tolerate "not found").
3. Print confirmation that the stack is back to idle.

## Security

Committing this script must not expose details or hand control of cloud deploys to a
malicious actor. Guarantees:

1. **No secrets or sensitive identifiers in the repo.** The script and docs contain only
   resource *names* (already present in `provision.sh`), never a subscription ID, tenant
   ID, connection string, publish profile, key, or IP address. The client IP is fetched
   at runtime and never written to the repo.
2. **Authority is the operator's own `az login` session.** The script embeds no
   credentials and creates no service principal. Cloning the repo grants no access; an
   actor would need the operator's authenticated Azure RBAC session.
3. **Local operator tool — never invoked by CI/automation.** No GitHub Actions workflow
   references it, and it must never be given stored cloud credentials. This prevents a
   malicious PR from editing the script into a deploy-control vector. A header comment
   states this explicitly; the implementation plan includes a check that no workflow
   calls `demo.sh`.
4. **Input hygiene.** The runtime-fetched public IP is validated against an IPv4 regex
   before being interpolated into any `az` command, so a malformed or hostile value from
   the IP-echo service cannot be injected.
5. **Minimal, reversible blast radius.** The only state change to shared infra is a single
   fixed-name **/32** firewall rule (operator's IP only), which `cool` deletes, plus an
   agent replica-count toggle. No broad ranges, no `0.0.0.0`, nothing destructive.

## Error handling

- Missing `az`/`curl` or unauthenticated session → fail in preflight with a clear next step.
- Any `az` mutation failure → non-zero exit surfacing the failing resource.
- IP fetch failure or non-IPv4 response → abort `warm` before touching the firewall.
- Health-check timeout → non-zero exit naming the endpoint still unhealthy, so a broken
  demo is caught before you present, not during.

## Testing / verification

- `bash -n scripts/azure/demo.sh` (syntax) and `shellcheck` if available (style/safety).
- `grep` check that no workflow under `.github/workflows/` references `demo.sh`.
- Manual live verification (needs `az login`): `demo.sh status` (read-only), then `warm`
  → confirm all three endpoints green and the agent serves real AI, then `cool` →
  confirm the firewall rule is gone and the agent is back to `min-replicas=0`.

## Files

- **Create** `scripts/azure/demo.sh` — the warm/status/cool operator script.
- **Modify** `docs/DEMO.md` — add a "Live cloud demo (deployed stack)" section.
