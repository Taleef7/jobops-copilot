# Audit Remediation

Follow-up work to the **2026-07-22 full-stack engineering & security audit** (7 parallel
specialist passes; overall grade **B**). This is the running journal of the remediation
program — one finding per branch, test-first, closed by its own PR.

- **Full audit report:** <https://claude.ai/code/artifact/6b022354-a3c5-4a35-8040-045efd2b8327>
- **Tracking epic:** [#152](https://github.com/Taleef7/jobops-copilot/issues/152)
- **Dominant theme:** a *fail-open* reflex — controls were present but silently downgraded to
  "trust the caller" when their config was absent. The program makes them fail **closed**.

## Phase 1 — Stop the bleeding ✅ merged

| Finding | Severity | Issue | PR |
| --- | --- | --- | --- |
| Auth fails open in both tiers → fail closed on a cloud runtime (API + agent) | Critical | [#153](https://github.com/Taleef7/jobops-copilot/issues/153) | [#157](https://github.com/Taleef7/jobops-copilot/pull/157) |
| `next@16.1.6` middleware-bypass CVEs → upgrade to 16.2.11 | High | [#154](https://github.com/Taleef7/jobops-copilot/issues/154) | [#160](https://github.com/Taleef7/jobops-copilot/pull/160) |
| Unhandled promise rejection could crash the API → `asyncHandler` + process net | High | [#155](https://github.com/Taleef7/jobops-copilot/issues/155) | [#158](https://github.com/Taleef7/jobops-copilot/pull/158) |
| Resilience: pool-listener leak, unguarded telemetry routes, timeout-less Gmail calls | High | [#156](https://github.com/Taleef7/jobops-copilot/issues/156) | [#159](https://github.com/Taleef7/jobops-copilot/pull/159) |

**Owner action (no PR):** rotate the OpenAI/Gemini/Tavily keys that were in the working-tree
`.env` (not committed, but in a OneDrive-synced path) and move the working copy off OneDrive.

### Behavioral note — auth now fails closed
In a production/Azure runtime (`NODE_ENV=production`, or `WEBSITE_SITE_NAME` / `CONTAINER_APP_NAME`
present) the API refuses to boot without `CLERK_SECRET_KEY`, the agent refuses to boot without
`AGENT_API_KEY`, and the `X-User-Id` dev shortcut is ignored. The live deploys already set these,
so nothing changes operationally — a future deploy that *loses* one now fails loudly instead of
silently serving unauthenticated. Local dev and tests are unchanged.

## Phase 2 — Close tenancy & gating holes 🚧 in progress

| Finding | Severity | Issue | PR |
| --- | --- | --- | --- |
| Cross-tenant RAG: `retrieve(user_id=None)` searched all tenants → scope to `IS NULL`; require `user_id` on `/rag/search` | High | [#161](https://github.com/Taleef7/jobops-copilot/issues/161) | _this PR_ |
| Gate merges + deploys on the full CI suite | High | [#162](https://github.com/Taleef7/jobops-copilot/issues/162) | _pending_ |
| Test the Postgres stores + tenancy SQL against a real DB in CI | Medium | [#163](https://github.com/Taleef7/jobops-copilot/issues/163) | _pending_ |
| Supply chain: SHA-pin Actions, add audit gates, pin the agent image | Medium | [#164](https://github.com/Taleef7/jobops-copilot/issues/164) | _pending_ |

## Phase 3 — Make the flagship AI claims true 📋 planned

Fix the eval "off" baseline and re-state the faithfulness numbers; distill the retrieval query so
the lexical + rerank sides actually fire; skip re-embedding unchanged résumés; trace the
assistant/chat paths; add an injection guard to `draft_outreach`.

## Phase 4 — Polish & harden for scale 📋 planned

Assistant a11y/stream fixes; loading/error boundaries; pagination + externalized limiter/cache;
reconcile the Bicep with live reality; refresh remaining stale docs.
