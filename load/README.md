# Load tests (k6) — Phase 5 · S

Lightweight [k6](https://k6.io) load tests for the JobOps API read path. They target the
public liveness/readiness probes (`GET /api/health`, `GET /api/health/ready`) so they need
no auth, while still exercising the Express stack, rate limiter, and the real DB ping under
concurrency.

## Install k6

k6 is a single Go binary — **not** an npm package, so it isn't in CI or `node_modules`:

```bash
winget install k6           # Windows
brew install k6             # macOS
# or: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## Run

```bash
# Against a locally running API (npm run dev:api → http://127.0.0.1:4000)
npm run loadtest

# Quick 1-VU/10s smoke
PROFILE=smoke k6 run load/api-read-path.js

# Against the deployed API
BASE_URL=https://jobops-api.azurewebsites.net k6 run load/api-read-path.js
```

| Env | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://127.0.0.1:4000` | API base URL |
| `PROFILE` | `load` | `load` (ramp to 10 VUs over ~60s) or `smoke` (1 VU, 10s) |

## Thresholds (the pass/fail gate)

The run **fails** (non-zero exit) if any threshold is breached:

- `http_req_failed` < 1% — virtually no errors
- `http_req_duration` p95 < 800ms — 95% of requests under 800ms
- `checks` > 99% — status codes and JSON shape as expected

`readiness` accepts **200 (ready) or 503 (db unreachable)** as valid, well-formed responses
— the script widens the per-request status classifier to 200|503 so a 503 doesn't inflate
`http_req_failed`; only a 5xx/timeout outside those, or a malformed body, counts as a failure.

> A cold Azure B1 instance (or a cold DB connection on the first `/health/ready`) can spike
> latency past the p95 budget on the opening requests of a ramp — run twice, or warm the app
> first, when measuring steady-state.

## CI note

k6 is intentionally **not** wired into CI (it needs a running target and the binary). These
scripts are authored and syntax-checked; run them manually against a local or deployed API
when validating capacity or after an infra change.
