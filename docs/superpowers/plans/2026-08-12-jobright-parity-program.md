# Jobright Parity Program — Implementation Guide & Ticket Index

> **For agentic workers:** every ticket below is a SELF-CONTAINED GitHub issue — implement one at a time, branch off main, one PR per ticket, the owner merges. Read the "How to work a ticket" section before your first PR.

**Goal:** Evolve JobOps Copilot into a personal Jobright replacement: four specialist LangGraph agents (feed-curator, resume-tailor, apply-copilot, connection-scout) + feed engine, alerts, resume studio, apply extension, connection scout.

**Architecture:** See the approved spec: docs/superpowers/specs/2026-08-12-jobright-parity-design.md (the contract; spec wins over ticket text on conflict).

**Tech stack:** Express 5 + TS + pg (apps/api) · Next.js + Clerk (apps/web) · FastAPI + LangGraph + Langfuse (services/agent) · Chrome MV3 extension (extensions/chrome, new) · Azure Container Apps + Bicep.

**Program epic:** https://github.com/Taleef7/jobops-copilot/issues/243

---

## Ticket index (build order: Epic 1 → {2,4,6 parallel} → 3 after 2 → 5 after 4 → 7 optional)

### [Epic 1 — Agent platform foundation (registry, per-agent configs, durable memory, cost guards)](https://github.com/Taleef7/jobops-copilot/issues/244) — #244

- [x] #251 **agent_configs table + seed tiering + GET/PUT /api/agents/:agentId/config** (M; blocked by: none) — merged in #299 (migration `012`; writes are operator-only via `ADMIN_USER_IDS`)
- [ ] #252 **get_model_for_agent(agent_id): hot-swappable per-agent models in provider.py (per-(agent,version) cache, env fallback)** (M; blocked by: #251)
- [ ] #253 **Four-graph registry + POST /agents/{agent_id}/stream|resume (SSE) + apps/api 3-hop proxy** (L; blocked by: #252)
- [ ] #254 **Durable AsyncPostgresSaver + AsyncPostgresStore in lifespan, thread/namespace conventions, checkpoint pruning** (L; blocked by: #253) — ⚠️ `RUN_MIGRATIONS_ON_BOOT` does NOT gate this DDL (it is read only by `apps/api`); own an agent-side setup lever and fail closed instead of falling back to the in-memory saver
- [ ] #255 **Per-agent Langfuse tags, per-run token budget with hard abort, recursion-limit defaults** (M; blocked by: #253)
- [ ] #256 **Assistant chat gains four specialist tools invoking the registry graphs (subagents pattern)** (M; blocked by: #253)
- [ ] #257 **langgraph.json for all graphs + local debugging doc (langgraph dev + Studio, LANGSMITH_TRACING=false)** (S; blocked by: #253)

### [Epic 2 — Feed engine: multi-source discovery, enrichment, scored + ranked feed](https://github.com/Taleef7/jobops-copilot/issues/245) — #245

- [ ] #258 **feat(api): enrich the jobs schema — salary/seniority/sponsorship/liveness columns, salary+seniority parsers, stop discarding Adzuna salary** (L; blocked by: none)
- [ ] #259 **feat(api): USAJobs + The Muse source adapters; fix the Remotive fallback window; multi-source discovery** (L; blocked by: #258)
- [ ] #260 **feat(api,web): target_companies table + CRUD + settings section to manage the ATS-board watchlist** (M; blocked by: none) — ⚠️ the table needs `user_id` + `unique (user_id, board_type, board_token)`; the spec's original column list omitted it and would have made one shared watchlist for every account
- [ ] #261 **feat(api): Greenhouse, Lever, and Ashby public-board adapters wired into discovery via target_companies** (L; blocked by: #258, #260)
- [ ] #262 **feat(api): USCIS H-1B Employer Data Hub import + h1b_sponsors table + sponsor_likelihood matching** (M; blocked by: #258)
- [ ] #263 **feat(api): fetch full JDs at discovery through the SSRF-hardened fetcher + extend the local prerank** (M; blocked by: #258)
- [ ] #264 **feat(api,infra): discovery every 20-30 min + daily liveness sweep — internal endpoints + ACA cron jobs (Bicep)** (L; blocked by: #258, #259)
- [ ] #265 **feat(agent,api): feed-curator graph — immediate cheap-tier scoring with sub-signals, persisted into job_analysis** (L; blocked by: #258, #251, #252)
- [ ] #266 **feat(agent,api,infra): nightly batch scoring — BatchScorer (Anthropic + OpenAI batch APIs), content_hash skip, cron submit/poll** (L; blocked by: #265, #264)
- [ ] #267 **feat(api): outcome-feedback view + ranked feed endpoint (GET /api/feed)** (M; blocked by: #258) — ⚠️ needs the `job_status_events` table from #258; `jobs.status` is overwritten in place, so without transition history the heuristic cannot tell "interviewed then rejected" from "rejected outright" and learns backwards
- [ ] #268 **feat(web): Today's best ranked feed — salary/seniority/sponsorship filters, sub-signal score chips, freshness badges** (L; blocked by: #267, #265)

### [Epic 3 — Alerts & notifications (Jobright parity)](https://github.com/Taleef7/jobops-copilot/issues/246) — #246

- [ ] #269 **feat(api): notifications table, dispatcher core, and inbox/settings API** (L; blocked by: none)
- [ ] #270 **feat(api): Telegram notification channel adapter** (S; blocked by: #269)
- [ ] #271 **feat(api): email channel adapter, daily digest, and digest cron endpoint** (L; blocked by: #269)
- [ ] #272 **feat(web,api): PWA installability + VAPID web-push channel** (L; blocked by: #269)
- [ ] #273 **feat(api): emit notification events — job matches, follow-up nudges, approvals** (M; blocked by: #269, #271)
- [ ] #274 **feat(web): notifications inbox, header bell, and notification settings UI** (L; blocked by: #269, #272)

### [Epic 4 — Resume studio: structured base resume, grounded tailoring, ATS-safe PDFs, cover letters](https://github.com/Taleef7/jobops-copilot/issues/247) — #247

- [ ] #275 **feat(db): structured base-resume data model — migration, shared schema (TS + Python), version store** (M; blocked by: none)
- [ ] #276 **feat(api): parse the stored resume into the structured model + base-resume CRUD routes** (M; blocked by: #275, #251)
- [ ] #277 **feat(web): base-resume editor under Settings (import, review, edit, save)** (M; blocked by: #276)
- [ ] #278 **feat(agent): resume-tailor LangGraph graph — plan/rewrite/groundedness gate/ATS pass/interrupt + zero-invented-facts evals** (L; blocked by: #275, #251, #252) — ⚠️ persist the draft as a `resume_versions` row (`approved = false`) BEFORE the interrupt, so #280/#281 have a real id to approve or reject
- [ ] #279 **feat(api): deterministic ATS-safe resume PDF renderer + blob storage + short-lived SAS URLs** (M; blocked by: #275)
- [ ] #280 **feat(api): resume-studio routes — start tailor run, approve→render→persist, reject-with-feedback, versions, gated download** (L; blocked by: #276, #278, #279)
- [ ] #281 **feat(web): tailored-resume review UI on job detail — old→new change summary with why, approve / reject-with-feedback, gated download** (M; blocked by: #280)
- [ ] #282 **feat(outreach): cover letters — draft via the moderated outreach chain, render to PDF with the shared pipeline** (M; blocked by: #275, #279)

### [Epic 5 — Apply copilot & Chrome extension](https://github.com/Taleef7/jobops-copilot/issues/248) — #248

- [ ] #283 **Apply-copilot data model: application_answers + ext_tokens tables, application_pack output kind, answers API** (M; blocked by: none)
- [ ] #284 **Apply-copilot agent: application-pack builder + POST/GET /api/jobs/:id/application-pack** (L; blocked by: #283)
- [ ] #285 **Job-detail application-pack view + flagged-question answer loop (web UI)** (M; blocked by: #284)
- [ ] #286 **Extension PAT auth: token issue/revoke API + Settings UI + /api/ext/* middleware with rate limiting** (M; blocked by: #283)
- [ ] #287 **Extension data API: /api/ext match, profile-fill, answers, applications capture** (M; blocked by: #284, #286)
- [ ] #288 **extensions/chrome scaffold: MV3 + TypeScript + esbuild, options page (API URL + PAT), README** (M; blocked by: #286)
- [ ] #289 **ATS autofill content scripts (Greenhouse, Lever, Ashby, Workday) + submission capture, tested on static fixtures** (L; blocked by: #287, #288)

### [Epic 6 — Connection scout: verified public-web contacts per job (People tab)](https://github.com/Taleef7/jobops-copilot/issues/249) — #249

- [ ] #290 **feat(api): job_contacts table, contact store, and contacts read/status routes** (M; blocked by: none)
- [ ] #291 **feat(agent): connection-scout LangGraph graph with fail-closed evidence verification + precision eval** (L; blocked by: #251, #252)
- [ ] #292 **feat(api): POST /api/jobs/:id/scout and POST /api/contacts/:id/draft-outreach** (M; blocked by: #290, #291)
- [ ] #293 **feat(web): People tab on job detail — contacts, evidence links, status chips, one-click draft outreach** (M; blocked by: #292)

### [Epic 7: Polish (optional) — mock interviews, negotiation coaching, extension overlay, semantic memory](https://github.com/Taleef7/jobops-copilot/issues/250) — #250

- [ ] #294 **[optional] Interactive mock-interview mode with STAR feedback and persisted session summary** (L; blocked by: none)
- [ ] #295 **[optional] Salary-negotiation coaching flow grounded in job + owner-provided offer details** (M; blocked by: none)
- [ ] #296 **[optional] Extension match-score overlay while browsing supported job boards** (M; blocked by: none)
- [ ] #297 **[optional] Semantic index on the LangGraph Store for cross-agent memory recall** (M; blocked by: none)

---

## What this program is

Evolve JobOps Copilot into a **personal Jobright replacement** — four specialist LangGraph agents (`feed-curator`, `resume-tailor`, `apply-copilot`, `connection-scout`) on the existing hardened stack, so the owner can cancel their Jobright subscription. Full design: [`docs/superpowers/specs/2026-08-12-jobright-parity-design.md`](https://github.com/Taleef7/jobops-copilot/blob/docs/jobright-parity-spec/docs/superpowers/specs/2026-08-12-jobright-parity-design.md) (lands on `main` when the spec PR merges). **Every ticket is self-contained** — you can implement one cold without reading the spec, but skim spec §2 (locked requirements), §5 (data model), §6 (API surface), §12 (invariants) if anything seems ambiguous. The spec wins over any ticket text that contradicts it.

## Epics

See the ticket index above.

**Order:** Epic 1 first (everything depends on it). Then epics 2, 4, 6 in parallel. Epic 3 after 2; epic 5 after 4. Epic 7 is optional polish, last. Within an epic, follow each ticket's "Blocked by" line.

## Non-negotiable invariants (from spec §12 — every PR must uphold these)

1. **Nothing auto-sends. Ever.** The extension never programmatically submits; outreach, tailored resumes, and applications require explicit owner approval (`interrupt()` + `approved` flags).
2. **Fail closed.** Budget exhausted → decline with a clear message, never partial-silent output. Groundedness violation → surfaced, never silently fixed. Unknown ATS page → extension does nothing.
3. **Resume grounding:** the tailor may reorder, reword, emphasize, or cut content present in the base resume; it may **never add** skills, employers, titles, dates, or metrics absent from it.
4. **Public web only** for connection discovery. No LinkedIn scraping or automation, ever.
5. All new outbound fetchers go through the SSRF-hardened fetch path (`apps/api/src/lib/job-url-fetch.ts`) or equivalent allowlist discipline.
6. PATs stored hashed and scoped to `/api/ext/*`; blob downloads via short-lived SAS; PII redaction in Langfuse traces stays on.
7. **No model hard-coded anywhere** — models resolve per agent from `agent_configs` via `get_model_for_agent()`; cost discipline (cheap tier + batch for high volume, prompt-cache-friendly prompt ordering) is a feature, not an optimization.

## How to work a ticket (read this before your first PR)

1. **Branch off `main`** per ticket: `feat/<short-name>` (or `fix/`, `docs/`). One ticket = one PR. The owner merges — never merge or self-approve.
2. **Read the whole ticket** including Testing and Invariants sections before writing code. Read every file the ticket tells you to read.
3. **TDD where the ticket specifies tests**: write the failing test, see it fail, implement, see it pass. Don't skip the "see it fail" step.
4. **Verify before claiming done** — run the commands below and paste key output in the PR description.
5. **PR description**: link the ticket (`Closes #NNN`), list what changed, note any deviation from the ticket (deviations need a stated reason).
6. Keep `main` shippable: no PR that leaves a feature half-wired behind no flag.

### Commands (verified against the repo)

```bash
# TypeScript (root; Node >= 22.19):
npm install
npm run check          # lint + typecheck + build (must pass)
npm run test:api       # apps/api node --test suites
npm run test:web       # apps/web tests
npm run test:e2e       # Playwright (apps/web)

# Python agent service (services/agent; see its README.md for local run):
pip install -r requirements.txt -r requirements-dev.txt   # plus requirements-rag.txt for RAG/checkpointer work
pytest                  # from services/agent/
# evals live in services/agent/evals/ and gate CI via .github/workflows/evals.yml

# Local dev: npm run dev (web + api together, scripts/dev.mjs); DB per apps/api/scripts/db-init.ts
```

## Secrets / owner action items (needed as epics land — owner provides, tickets must degrade gracefully without them)

| Needed by | Env vars |
|---|---|
| Epic 2 | `USAJOBS_API_KEY` (+ email header), Muse key if required; USCIS H-1B Data Hub CSV (annual manual download) |
| Epic 3 | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`; VAPID key pair (generated once); SMTP creds **or** existing n8n email webhook |
| Epic 1+ | `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` (Cloud Hobby, free); provider API keys per `agent_configs` (e.g. `OPENAI_API_KEY` for `openai:gpt-5.6-luna`, `ANTHROPIC_API_KEY`) |

**Budget ceiling: < $20/month all-in.** Default tiering: feed-curator on a cheap model via batch API; the other three on a premium model with prompt caching. If a ticket tempts you toward an expensive pattern (per-job premium calls, unbatched scoring, retry loops), the ticket is wrong — flag it on the issue instead of implementing it.

## Definition of done (program)

- Every job in the feed is scored on arrival; fresh high-match jobs alert the owner's phone within ~30 minutes of posting.
- Per-job tailored ATS-safe PDF resume + cover letter, grounded (zero invented facts), approve-then-download.
- Application packs autofill Greenhouse/Lever/Ashby/Workday via the personal extension; owner reviews and submits; submissions auto-captured into the tracker.
- Per-job public-web contact discovery with evidence links + approval-gated outreach drafts.
- Per-agent cost visible in the agents hub; monthly all-in spend under $20.
