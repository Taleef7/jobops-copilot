# JobOps × Jobright Parity — Design

**Date:** 2026-08-12
**Status:** Draft for owner review
**Goal:** Evolve JobOps Copilot into a personal Jobright replacement — same product value, owner's own stack — so the Jobright subscription can be cancelled. Not a literal clone: where research showed Jobright is weak (opaque scores, hallucinated resume content, shallow tracker), JobOps keeps or extends its existing better answer.

This spec is the contract for a series of implementation epics. Implementers (human or model) should treat the **Decisions** and **Invariants** sections as non-negotiable and everything referenced by file path as "extend, don't replace."

---

## 1. Context: what the research established

### 1.1 What Jobright users actually pay for (from reviews, Reddit, comparisons)

1. **Being early**: fresh high-match postings pushed to their phone, applying inside the early-applicant window. Most-credited feature for actually getting interviews.
2. **Per-job tailored ATS resume documents** generated in seconds (Turbo's flagship).
3. **Autofill into ATS forms** (Chrome extension; the "Agent" is largely assisted autofill, not true autonomy).
4. **A fully scored feed** with match percentages and an H1B-sponsorship filter.
5. Insider connections (alumni/recruiter surfacing), Orion chat, interview prep — valued but secondary.

Known Jobright weaknesses to avoid replicating: inflated/opaque match scores, invented skills/metrics in generated resumes, stale/ghost listings, a 5-status tracker with no notes, uncertainty about what the Agent actually submitted.

### 1.2 Where JobOps already stands (inventory, 2026-08-12)

Already **better** than Jobright: 11-status tracker with notes/priorities/next-actions (`apps/api/src/routes/jobs.ts`), per-job analysis transparency (`job_analysis`: matched/missing skills, ATS keywords, fit summary, apply recommendation), groundedness + moderation guardrails (`services/agent/app/safety/*`), interview-prep & skill-gap agents (`services/agent/app/agents/runner.py`), weekly reports, full data export, per-user daily AI budget (`apps/api/src/lib/budget.ts`).

Critical gaps (ranked): no tailored-resume document generation (schema `resume_versions` exists since migration 001, never wired); zero notifications; 24 h discovery cadence; feed mostly unscored (Adzuna ~500-char snippets defeat the local prerank in `apps/api/src/lib/local-fit.ts`); single real source (Adzuna; Remotive fallback ignores search params); no autofill vehicle; no connections features; no salary/seniority/sponsorship fields or filters; no outcome feedback into ranking; no ghost-job liveness checks.

---

## 2. Locked requirements (owner Q&A, 2026-08-12)

| Decision | Value |
|---|---|
| Pillars in scope | All four: match feed, resume tailoring, apply assist, insider connections |
| Agent architecture | **Four dedicated agents**, one per pillar, on LangChain/LangGraph; Langfuse observability |
| Budget ceiling | **< $20/month all-in** (LLM + APIs + observability delta; Azure hosting as today) |
| Apply autonomy | **Approve-then-submit**: agent prepares + fills; a human reviews and clicks submit. Nothing auto-sends — permanent invariant |
| Connections data | **Public web only.** No LinkedIn scraping/automation ever |
| Market | **US + sponsorship signal** (USCIS H-1B employer data) |
| Alert channels | Email (instant + daily digest), **PWA web push**, **Telegram bot** |
| Resume output | **ATS-safe PDF** from a clean single-column template |
| Models | **Provider-agnostic, hot-swappable per agent** (owner plans OpenAI `gpt-5.6-luna`; must also run Anthropic/Azure/Gemini) — no model hard-coded anywhere |
| Approach | Evolve in place, pillar-by-pillar epics; keep all existing hardening |

**Non-goals:** multi-tenant features, billing, native mobile apps, LinkedIn automation, fully autonomous submission, a curated interview-question corpus, LangGraph Platform / LangSmith Deployment, self-hosted Langfuse, semantic-cache infrastructure (Redis), rebuilding the existing assistant.

---

## 3. Architecture overview

Monorepo keeps its shape. New/changed responsibilities:

```
apps/web            Next.js + Clerk. Adds: notifications inbox + bell, PWA (manifest,
                    service worker, web push), resume studio UI, application-pack view,
                    people tab, agents hub page, new feed filters/"Today's best".
apps/api            Express 5 + pg (system of record). Adds: new job sources, USCIS data,
                    notification dispatcher (email/Telegram/web-push adapters), resume PDF
                    rendering, blob storage for documents, extension endpoints (PAT auth),
                    new tables + CRUD, cron-triggered internal endpoints.
services/agent      FastAPI + LangGraph (Python). Becomes the four-agent home:
                    feed-curator, resume-tailor, apply-copilot, connection-scout as four
                    independently compiled StateGraphs in a registry; existing assistant
                    graph unchanged and gains 4 tools that call the specialists.
extensions/chrome   NEW. Personal MV3 extension (loaded unpacked): ATS autofill from
                    application packs + auto-capture of submitted applications.
infra (Bicep)       Azure Container Apps Jobs (cron): discovery, nightly batch scoring,
                    daily digest, liveness checks, checkpoint pruning, Langfuse metrics pull.
```

### 3.1 Multi-agent topology (decision + rationale)

**Four independent compiled graphs behind a registry dict in the existing FastAPI service.** No LangGraph Platform (now "LangSmith Deployment", $39/seat/mo minimum), no self-hosted `langgraph-api` (ELv2 license, mandatory Redis, incompatible with scale-to-zero), no `langgraph-supervisor`/`langgraph-swarm` libraries (maintainers themselves now recommend direct tool-calling composition; 4 mostly-independent specialists don't need a supervisor loop).

- **Conversation state:** each agent gets its own thread via the shared `AsyncPostgresSaver` (`langgraph-checkpoint-postgres`, already a dependency): `thread_id = "{user_id}:{agent_id}[:{job_id}]"`. Agents never see each other's message history.
- **Shared long-term memory:** one `AsyncPostgresStore` on the existing Postgres. Namespaces: `("user", user_id, "profile")` — read-only to all four agents (resume, preferences, constraints); `("user", user_id, agent_id)` — private per agent (e.g. apply-copilot's learned Q&A). Optional semantic index reuses the existing pgvector stack later; not required for v1.
- **Human gates:** every outward-facing artifact pauses on `interrupt()` inside the producing node (or `HumanInTheLoopMiddleware` with `interrupt_on` for tool-shaped actions) and resumes with `Command(resume=...)`. The durable Postgres checkpointer makes approvals survive restarts. Interrupted nodes must be idempotent (they re-run on resume).
- **Invocation surface:** `POST /agents/{agent_id}/stream` (SSE via `astream`, reusing the existing 3-hop streaming plumbing web → api → agent) and `POST /agents/{agent_id}/resume`. Cron invokes feed-curator through an internal endpoint on `apps/api` which calls the agent service service-to-service (existing auth pattern).
- **Front-door chat:** the existing assistant gains four tools (`run_feed_curation`, `tailor_resume`, `build_application_pack`, `scout_connections`) that invoke the same compiled graphs — the official "subagents" pattern. UI buttons invoke agents directly (zero routing tokens); chat is a convenience layer.

### 3.2 Model interoperability (decision)

Extend, don't replace, `services/agent/app/llm/provider.py` (already `init_chat_model`-based with Anthropic/OpenAI/Azure/Gemini support):

- New `get_model_for_agent(agent_id)` resolves from the **`agent_configs` table** (see §5): active row carries `model` as a `"provider:model-id"` string (e.g. `openai:gpt-5.6-luna`, `anthropic:claude-haiku-4-5`), plus params (temperature, max_tokens, reasoning effort where applicable). Falls back to current env-based `get_model()` when no row exists. The current `@lru_cache` global must become a per-(agent, version) cache.
- Changing a model = insert new config version + repoint `active`. No deploy. Rollback = repoint. An admin endpoint + a read-only view in the web UI's agents hub expose this.
- Structured outputs exclusively via LangChain `with_structured_output` (maps to strict JSON schema on both OpenAI and Anthropic) — no hand-rolled JSON parsing/retry loops; cap application-level retries at 1.
- Prompt-cache discipline is provider-neutral: frozen system prompt first, stable resume/profile block second, volatile job text last. Anthropic gets explicit `cache_control` breakpoints on the stable prefix; OpenAI caches such prefixes automatically (≥1024 tokens). Never reorder the prefix or mutate the tool list mid-thread.
- Batch scoring (§7) goes through a thin `BatchScorer` interface with per-provider implementations (both Anthropic and OpenAI batch APIs give ~50% off); if a configured provider has no batch implementation, fall back to sequential Haiku-tier calls under the daily budget.
- Langfuse: register custom model pricing for any model id it doesn't know (e.g. `gpt-5.6-luna`) so per-agent cost dashboards stay accurate.

### 3.3 Default model tiering (initial `agent_configs` seed — all swappable)

| Agent | Default tier | Why |
|---|---|---|
| feed-curator | cheap tier (e.g. `anthropic:claude-haiku-4-5`) via **batch API** | High volume, structured scoring; 50% batch discount |
| resume-tailor | premium tier (e.g. `anthropic:claude-sonnet-4-6` or `openai:gpt-5.6-luna`) | Quality-critical, low volume |
| apply-copilot | premium tier | Answer quality under grounding constraints |
| connection-scout | premium tier | Web-research judgment |
| assistant (existing) | unchanged | — |

---

## 4. The four agents

### 4.1 `feed-curator` (deterministic pipeline; headless; cron-driven)

**Language boundary (explicit, to prevent a porting mistake):** the discovery half of the pipeline is TypeScript in `apps/api` — source adapters, normalize/dedup, full-JD fetch (reuse the SSRF-hardened `apps/api/src/lib/job-url-fetch.ts`), enrichment (salary parse, seniority, sponsorship match vs `h1b_sponsors`), and the cheap local prerank (extend `local-fit.ts` to full JDs). The **feed-curator LangGraph graph in `services/agent`** is the curation brain only: LLM scoring, ranking with outcome feedback, and notification-event emission. `apps/api` invokes it service-to-service after each discovery run.

```
apps/api (cron): fetch(all sources) → normalize + dedup (URL, fingerprint, content_hash)
                 → fetch full JD → enrich → local prerank
                 → invoke feed-curator with new/changed jobs
feed-curator:    prerank ≥ instant-threshold → immediate LLM score; else queue for nightly batch
                 → persist job_analysis → rank (incl. outcome-feedback view)
                 → emit notification events for score ≥ alert threshold
```

Output extends the existing `job_analysis` shape: 0–100 score, sub-signals (skills, experience, seniority-fit, salary-fit, sponsorship-likelihood), `apply/review/pass`, "why you fit" summary. **Every job gets scored** — the free-tier-Jobright hook JobOps currently lacks.

**Outcome feedback (v1 = heuristics, not ML):** ranking-time adjustments from pipeline history — companies with k+ rejections and no interviews get a penalty; title-families that reached interview/offer get a boost. Implemented as a SQL view over jobs + status history applied at rank time; no new learning infrastructure.

> **Prerequisite (added after review):** `jobs.status` is overwritten in place by `updateJob`, so today's schema cannot answer "did this reach interview before it was rejected?" — a job that interviewed and was then rejected is indistinguishable from a straight rejection, and the heuristic would learn the opposite of the truth. A `job_status_events` append-only table (§5) must land with the schema work in #258 before #267 builds the view; the view reads transitions, never the current `status` alone.

### 4.2 `resume-tailor` (interactive; interrupt-gated)

Precondition: a **structured base resume** (JSON-Resume-style model). One-time migration flow: LLM parses the existing stored resume text into the structured model → owner reviews/edits in a "base resume editor" → saved as the canonical base (Store `("user", id, "profile")` + `resume_versions` base row).

```
plan edits (vs job + feed-curator analysis) → rewrite sections
→ groundedness self-check (reuse services/agent/app/safety/groundedness.py)
→ ATS keyword pass (cover job_analysis.ats_keywords honestly — no keyword stuffing)
→ render request → interrupt(approval)
   (before the interrupt: persist the draft as a `resume_versions` row with `approved = false`,
    so the review UI and the approve/reject endpoints have a real `:id` to address)
   approve → apps/api renders ATS-safe single-column PDF → blob storage → same row gains
             file_url + approved = true
   reject(feedback) → resume graph with owner notes
```

**Grounding invariant:** the tailor may reorder, reword, emphasize, and cut content present in the base resume; it may never add skills, employers, titles, dates, or metrics absent from it. Violations fail the groundedness gate and are surfaced, not silently fixed. (This is the direct counter to Jobright's documented hallucination weakness.)

Approval UI shows a per-section change summary ("what changed and why", old→new). Also drafts a **cover letter** per job — new `cover_letter` value in the `outreach` `message_type` CHECK (migration), reusing the existing draft/moderation chain; renderable to PDF with the same pipeline.

PDF rendering lives in `apps/api` (deterministic template, `@react-pdf/renderer` or equivalent pure-JS renderer — no headless browser): structured resume JSON in → ATS-safe single-column PDF out. Stored via `@azure/storage-blob` (already a dependency); downloads via short-lived SAS URLs.

### 4.3 `apply-copilot` (interactive; produces the application pack; extension consumes it)

Per job, assembles an **application pack**: approved tailored-resume PDF (+ cover letter), copy-ready answers to common ATS questions (work authorization, salary expectation from preferences, "why us" from research output, behavioral stubs), recruiter/contact block, and flags for questions it cannot ground in the profile. Persisted as `agent_outputs` kind `application_pack` (existing table, migration 008 pattern).

**Q&A memory:** unanswerable questions are asked of the owner once (UI or extension prompt), stored in `application_answers`, and pre-filled forever after. The pack builder consults this table first.

**The Chrome extension** (`extensions/chrome`, MV3, loaded unpacked):
- Detects supported ATS pages: **Greenhouse, Lever, Ashby, Workday** (in that build order; Workday is the hard one). iCIMS is explicitly out of scope for this program — no ticket, no fixtures, and an unknown page must make the extension do nothing (§12) rather than guess.
- Pulls the matching pack from `apps/api` (job matched by URL/company+title; manual picker fallback), fills fields, highlights what it filled and what it left blank.
- **Never clicks submit.** On the owner's own submit, detects the confirmation state and POSTs a capture: status → `applied`, timestamp, resume version used, ATS, URL. (Auto-capture — a tracked Jobright parity gap.)
- Auth: personal access token (PAT) generated in Settings, stored hashed (`token_hash`) server-side, scoped to `/api/ext/*` routes only, revocable. No Clerk flows inside the extension.

### 4.4 `connection-scout` (interactive; public web only)

```
identify targets (recruiters, hiring managers, likely teammates for the job's company/team)
   via Tavily (already wired: services/agent/app/agents/tools.py) + public pages, GitHub,
   engineering blogs, conference talks
→ verify: every person must carry ≥1 public evidence URL; unverifiable candidates dropped
→ rank by relevance to THIS job → persist job_contacts rows
→ optional: draft outreach per contact (existing draft_outreach chain; types
   referral_request / linkedin_connection / recruiter_email) → interrupt() before send-ready
```

UI: a "People" tab on job detail listing contacts with evidence links and one-click "draft outreach". **No LinkedIn scraping or automation; nothing sends without approval** (existing outreach invariant unchanged).

---

## 5. Data model changes (`apps/api/db/migrations/`)

New tables:

| Table | Purpose / key columns |
|---|---|
| `agent_configs` | `agent_id`, `version`, `model` ("provider:model"), `params` JSONB, `prompt_overrides` JSONB, `active` bool (one active per agent, partial unique index), `created_at` |
| `notifications` | `user_id`, `kind` (job_match/digest/follow_up/approval_needed/agent_done), `title`, `body`, `job_id?`, `dedupe_key` UNIQUE, `channels` JSONB (per-channel sent/failed + timestamps), `read_at?`, `created_at` |
| `h1b_sponsors` | normalized `employer_name`, `fiscal_year`, `approvals`, `denials` (USCIS H-1B Employer Data Hub import; annual refresh script) |
| `application_answers` | `user_id`, `question_hash`, `question_text`, `answer`, `ats?`, timestamps — the apply Q&A memory |
| `job_contacts` | `job_id`, `name`, `role_title`, `evidence` JSONB (URLs, required non-empty), `relevance`, `status` (found/outreach_drafted/contacted), timestamps |
| `target_companies` | `user_id`, `company`, `board_type` (greenhouse/lever/ashby), `board_token`, `enabled` — direct ATS-board polling list, owned per user like every other user table (`unique (user_id, board_type, board_token)`); discovery runs per user and reads only that user's rows |
| `job_status_events` | `job_id`, `user_id`, `from_status?`, `to_status`, `created_at` — append-only pipeline transitions. `jobs.status` is overwritten in place, so this is the only record that a job reached `interview` before `rejected`; the outcome-feedback view (§4.1, #267) reads it |
| `ext_tokens` | `user_id`, `token_hash`, `label`, `last_used_at`, `revoked_at?` — extension PATs |

Changed tables:

- `jobs`: add `salary_min`, `salary_max`, `salary_currency` (stop discarding Adzuna salary in `normalize.ts`; parse from JD text as fallback), `seniority`, `sponsor_likelihood` (known_sponsor/unknown + counts snapshot), `content_hash` (dedupe/re-list detection; batch never re-scores same hash), `last_seen_at`, `liveness` (active/stale/expired).
- `user_profiles`: add `preferences` JSONB (salary floor, seniority band, sponsorship_required, company blocklist, title include/exclude, alert threshold, quiet hours, digest hour, channels on/off).
- `outreach`: extend `message_type` CHECK with `cover_letter`.
- `resume_versions` (exists, unused): wire it — add `file_url` population (blob), `source_config_version`, keep `approved` gate.
- LangGraph: `checkpointer.setup()` + `store.setup()` create their own tables from the **Python agent's lifespan**, not from `apps/api`'s migrate-on-boot path — `RUN_MIGRATIONS_ON_BOOT` is read only by `apps/api/src/lib/migrate-on-boot.ts` and does **not** gate this DDL. #254 therefore owns an agent-side equivalent: a single explicit setup step with its own `AGENT_RUN_SETUP_ON_BOOT` lever, and a failure must surface (fail closed) rather than silently degrading to the in-memory saver, which would make "durable memory" a lie in production. Weekly checkpoint-pruning job (delete checkpoints older than N days, N configurable, default 30).

---

## 6. API surface (new/changed, all Clerk-authed unless noted)

**Agents (proxy, 3-hop SSE like `assistant-chat.ts`):** `POST /api/agents/:agentId/stream`, `POST /api/agents/:agentId/resume`, `GET /api/agents/:agentId/runs?jobId=` (history from agent_outputs/checkpoints), `GET /api/agents/:agentId/config` (any signed-in user) and `PUT /api/agents/:agentId/config` (**operator-only**). `agent_configs` is global — keyed by `agent_id`, with no `user_id` and one active version per agent — so an ordinary user must not be able to repoint the model every other user's agents run on. Writes are gated on an `ADMIN_USER_IDS` allowlist that fails closed when unset on a real deploy (shipped in #251).

**Notifications:** `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET/PUT /api/notification-settings`, `POST /api/notifications/test` (fires all configured channels), `POST /api/push/subscribe` + `DELETE` (web-push subscriptions).

**Resume studio:** `POST /api/jobs/:id/tailor` (starts run), `GET /api/jobs/:id/resume-versions`, `POST /api/resume-versions/:id/approve|reject`, `GET /api/resume-versions/:id/download` (SAS), `GET/PUT /api/profile/base-resume` (structured model).

**Apply:** `POST /api/jobs/:id/application-pack`, `GET /api/jobs/:id/application-pack`.

**Extension (PAT-authed, `/api/ext/*` scope only, rate-limited):** `GET /api/ext/match?url=` (resolve ATS page → job + pack), `POST /api/ext/applications` (capture submission), `GET/POST /api/ext/answers` (Q&A memory), `GET /api/ext/profile-fill` (flattened field map).

**Contacts:** `POST /api/jobs/:id/scout`, `GET /api/jobs/:id/contacts`, `POST /api/contacts/:id/draft-outreach`.

**Internal (service-to-service, existing machine-auth pattern):** `POST /internal/discovery/run` (cron), `POST /internal/score/batch-submit` + `/batch-poll`, `POST /internal/digest/run`, `POST /internal/liveness/run`, `POST /internal/langfuse/pull-metrics`.

---

## 7. Sourcing & freshness

- **Sources (all free):** Adzuna US (existing, keyed) · Greenhouse/Lever/Ashby **public board APIs** for `target_companies` (full JDs, freshest signal — the personal-scale version of Jobright's career-page monitoring) · USAJobs API · The Muse API · Remotive (fix: apply search params client-side since the API ignores them) · optional JSearch free tier behind a feature flag. Each source = one adapter module implementing the existing `job-sources` interface (fetch → normalized Job), with fixture-based tests.
- **Cadence:** ACA cron job every **20–30 min** (waking hours, config) replaces the 24 h n8n schedule; n8n workflows remain optional/deprecated-not-removed. Per-second billing inside the ACA free grant ≈ $0.
- **Freshness honesty:** `last_seen_at` updated when a listing re-appears; daily liveness job re-checks open, non-applied jobs' URLs (HEAD/GET via the SSRF-hardened fetcher) → `stale`/`expired` flags shown in the feed (counter to Jobright's ghost-listing complaint).
- **Sponsorship signal:** normalized employer match against `h1b_sponsors` → `sponsor_likelihood` + approval counts on the job card; feed filter "likely sponsors only". Data refresh = annual script run.

## 8. Notifications

Dispatcher in `apps/api` (new `src/lib/notify/`): every event writes a `notifications` row first (in-app inbox = source of truth, bell in the web header), then fans out per settings:

- **Telegram**: personal bot token + chat id in env; message with job title/company/score + deep link. Simplest, most reliable phone path.
- **Web push (PWA)**: manifest + service worker + VAPID web-push; subscriptions stored server-side. Web app becomes installable.
- **Email**: instant for score ≥ threshold; daily digest (top new matches, follow-ups due, approvals pending). Via existing n8n email webhook when configured, else direct SMTP (env-driven; provider-agnostic nodemailer-style adapter).

`dedupe_key` (e.g. `job_match:{job_id}`) guarantees at-most-once per event per channel. Failures log to the `channels` JSONB and never block other channels. Quiet hours + thresholds live in `user_profiles.preferences`.

## 9. Cost architecture (< $20/mo ceiling)

| Item | Est. monthly |
|---|---|
| LLM — feed scoring (50–100 jobs/day, cheap tier, 50% batch, content-hash dedupe) | $2–6 |
| LLM — tailoring/packs/scout/chat (premium tier, prompt-cached) | $6–12 |
| Job source APIs / USCIS / Telegram / web-push | $0 |
| Langfuse Cloud Hobby (50k units/mo) | $0 |
| ACA cron jobs (within free grant) / extension (unpacked) | ~$0 |
| **Typical total** | **~$10–18** |

Guards: per-run token budget accumulated from `response.usage` in graph state with hard abort; `recursion_limit` 10–15 on pipeline graphs, ~30 on chat; existing daily budget (`apps/api/src/lib/budget.ts`) stays as the outer wall — raise default only if scoring volume demands it, per-agent budget lines in the agents hub. Worst case (everything premium-tier, zero cache hits) ≈ $45 — still visible early via Langfuse cost dashboards + a spend alert (Langfuse Hobby includes 2 alerts).

## 10. Observability

Langfuse Cloud Hobby (free): extend the existing no-op-safe integration (`services/agent/app/obs/langfuse.py`) — per-agent `trace_name`/tags (`feed`, `tailor`, `apply`, `scout`, `assistant`), session ids per thread, PII masking already in place. Watch the 50k units/mo cap (deep runs burn 20–40 units → budget ~1.5–2.5k runs/mo; sample feed-curator spans if needed). Weekly cron pulls `/api/public/metrics/daily?tags=...` into Postgres so per-agent cost history outlives the 30-day retention; agents hub reads this table. `langgraph.json` + `langgraph dev` + free LangGraph Studio for local graph debugging only (no hosted anything).

## 11. Testing

- **Unit:** every source adapter against recorded fixtures; salary/seniority parsers; sponsorship matcher (name-normalization edge cases); dispatcher dedupe; PAT auth; PDF renderer snapshot (deterministic input → stable text layer).
- **Agent evals (extend the existing two-tier eval-gating pattern in `services/agent/evals/`):** tailor — groundedness suite asserting **zero invented facts** across a seeded base-resume/job set (hard gate); feed-curator — golden scoring set with rank-correlation threshold vs rubric (soft gate, hard floor); apply-copilot — answer grounding vs profile; scout — evidence-URL precision (every returned person has a live public source).
- **Integration:** interrupt→resume round-trips survive a service restart (checkpointer); batch submit/poll lifecycle; prompt-cache hit assertion (`cache_read_input_tokens > 0` / provider equivalent) as a canary test.
- **E2E (existing Playwright suite):** notification inbox flow; tailor approve/reject loop; application-pack view. Extension autofill tested against **saved ATS form fixtures** (static HTML of Greenhouse/Lever/Ashby/Workday forms) — no live-site tests in CI.

## 12. Error handling & security invariants

1. **Nothing auto-sends. Ever.** The extension never programmatically submits; outreach and resumes require explicit approval (`interrupt()` + `approved` flags). This invariant survives all future epics.
2. **Fail closed** (audit through-line): budget exhausted → agent declines with a clear message, never partial-silent output; groundedness violation → surfaced, not auto-corrected; unknown ATS page → extension does nothing.
3. All new outbound fetchers (boards, liveness, USCIS) go through the existing SSRF-hardened fetch path or equivalent allowlist discipline.
4. PATs stored hashed, scoped to `/api/ext/*`, revocable; blob downloads via short-lived SAS; PII redaction in traces stays on.
5. Idempotency: interrupted nodes re-run on resume; submission capture and notification dedupe keys make replays harmless; batch scoring skips already-scored `content_hash`es.

## 13. Phasing — seven epics

| # | Epic | Ships | Depends on |
|---|---|---|---|
| 1 | **Agent platform foundation** | Graph registry + per-agent routes; `agent_configs` + `get_model_for_agent`; checkpointer/Store setup + pruning; per-agent Langfuse tags; per-run budget guards; assistant's 4 specialist tools (stubs OK) | — |
| 2 | **Feed engine** | Source adapters (boards/USAJobs/Muse/Remotive-fix); `target_companies`; USCIS import + sponsorship; full-JD fetch; salary/seniority enrichment; feed-curator graph; immediate+nightly batch scoring; new filters + "Today's best" UI; outcome-feedback view | 1 |
| 3 | **Alerts** | `notifications` + dispatcher; Telegram, PWA push, email instant/digest; inbox UI + bell; settings; follow-up nudges migrate off n8n | 2 |
| 4 | **Resume studio** | Structured base-resume model + editor; resume-tailor graph; PDF renderer + blob; `resume_versions` wiring; diff-review approve/reject UI; cover letters | 1 |
| 5 | **Apply copilot** | Application packs; `application_answers`; Chrome extension (Greenhouse → Lever → Ashby → Workday) autofill + capture; PAT auth; extension settings page | 4 |
| 6 | **Connection scout** | scout graph; `job_contacts` + evidence gating; People tab; outreach integration | 1 |
| 7 | **Polish (optional)** | Mock-interview loop w/ STAR feedback; salary-negotiation flow; extension score overlay; semantic Store index | 2,4,5 |

Epics 2/4/6 are independent after 1 and can be built in parallel by different implementers. Every epic leaves `main` shippable; each sub-issue branches off `main` per repo convention (PRs opened, owner merges).

## 14. Decisions log (rejected alternatives)

- LangGraph Platform / LangSmith Deployment — $39/mo min, kills the budget. **Rejected.**
- Self-hosted `langgraph-api` — ELv2, Redis requirement, no scale-to-zero. **Rejected.**
- `langgraph-supervisor` / `langgraph-swarm` — wrong shape for 4 independent specialists; maintainers recommend direct composition. **Rejected.**
- Self-hosted Langfuse v3 — ClickHouse+Redis+S3, $60–130/mo infra. **Rejected** (cloud Hobby free tier; Arize Phoenix as one-container escape hatch if the cap ever binds).
- LinkedIn scraping/automation — ToS, account risk. **Rejected permanently** (public web + optional owner-exported connections CSV later).
- Fully autonomous submission — quality/risk; Jobright's own agent is mostly assisted autofill. **Rejected** in favor of approve-then-submit.
- LangSmith as primary observability — 14-day retention, nested-run trace-count burn. **Rejected** (free Prompt Hub optionally for prompt experiments).
- Semantic caching (Redis LangCache/GPTCache) — pointless at single-user scale; content-hash dedupe covers it. **Rejected.**
- Native mobile app — PWA + Telegram covers phone alerts. **Rejected.**
