# JobOps Copilot — MCP server

A **Model Context Protocol** server (FastMCP, streamable-HTTP) that exposes JobOps as tools
for MCP clients (e.g. MCP Inspector, Claude). Phase 3 · Workstream L.

It is a thin **bridge over the existing REST API** (`apps/api`) — it never touches the
database, so it reuses every store, guard, and rate-limit the API already enforces. It is a
standalone package with its own venv, intentionally isolated from the agent's FastAPI pins.

## Tools

| Tool | What it does |
| --- | --- |
| `search_jobs(user_id, query?)` | The user's tracked jobs, optionally filtered by title/company. |
| `get_job(user_id, job_id)` | One job with its analysis + outreach drafts. |
| `list_saved_searches(user_id)` | The user's saved job searches. |
| `score_fit(user_id, job_id)` | Score the resume against a stored job. |
| `draft_outreach(user_id, job_id, message_type?)` | Draft outreach (human-review only — never sends). |

## Auth model

Each call sends the shared API key (`MCP_SERVER_API_KEY`, which **must equal the API's
`API_SHARED_SECRET`**) plus the acting `X-User-Id`, so the API's service-auth path resolves
the user (see `apps/api/src/lib/auth.ts`). The shared key lives only server-side and is
never exposed to MCP clients. **Deploy the MCP server behind network access control** (it
can act as any user via the shared key); per-MCP-client OAuth is a future hardening step.

## Run it

```bash
cd services/mcp
python -m venv .venv && .venv/Scripts/activate   # (or source .venv/bin/activate)
pip install -r requirements-dev.txt

export MCP_SERVER_API_BASE_URL=http://127.0.0.1:4000   # the JobOps API
export MCP_SERVER_API_KEY=<same value as the API's API_SHARED_SECRET>
python server.py                                       # streamable-HTTP on the default port
```

Then point an MCP client at it (e.g. `npx @modelcontextprotocol/inspector`) to list and call
the tools end to end against a running JobOps API.

## Tests & lint

```bash
pytest          # mocks the REST API via httpx.MockTransport — no live server needed
ruff check .
```
