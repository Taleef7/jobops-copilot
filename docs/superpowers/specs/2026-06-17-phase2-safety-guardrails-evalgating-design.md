# Design — Phase 2: Safety, guardrails & eval gating

**Date:** 2026-06-17
**Status:** Approved (design accepted; scope: all four safety dimensions + two-tier eval gating; balanced portfolio-signal/prod-hardening driver)
**Part of:** the "Production-grade AI" program (Phases 1–5). Phase 1 (real data + LLMOps backbone) shipped in #44/#45/#46. This spec covers **Phase 2 only**.

## 1. Why

Phase 1 proved JobOps can *operate* AI on real data with tracing and evals. It does
not yet prove it can do so **safely** or that quality **cannot silently regress**.
Phase 2 is the production-hardening half of the 2026 AI-ops story: protect the API
edge from abuse and runaway cost, keep user PII out of third-party LLMs and traces,
defend the LLM against untrusted input, and turn the report-only eval job into a real
**gate**. Both drivers weigh equally: every piece must read credibly in the portfolio
**and** genuinely protect the live app (real Adzuna ingestion, real LLM spend).

## 2. Goals / non-goals

**Goals**
- **G — API edge.** Per-user/per-IP rate-limiting on expensive routes, a per-user
  daily **cost ceiling**, and security headers (`helmet`).
- **H — Data privacy (PII).** Strip contact-PII before third-party LLM calls (it is
  not needed for parse/score) and mask PII in Langfuse traces and logs; a stated
  retention/scrub policy.
- **I — LLM I/O guardrails.** Prompt-injection defense around untrusted JD text +
  output moderation on generated outreach.
- **J — Eval gating + full `EVALS.md`.** Two-tier gate: deterministic parse-job
  metrics block PRs; Ragas runs report-only with regression alerting on `main`. Full
  metrics documentation.

**Non-goals (deferred to later phases)**
- LangGraph / MCP / streaming (Phase 3).
- Hybrid retrieval / reranker / fine-tuning (Phase 4).
- IaC / full Dockerization / e2e / caching / load test (Phase 5).
- Platform-level WAF / DDoS, SSO / advanced authorization (out of program scope).
- Azure **subscription billing** controls — already covered by the
  `2026-06-12-cost-controls` design (budget alerts + pause/resume). Phase 2's cost
  ceiling is a **distinct application layer** (per-user LLM spend), complementary to it.

## 3. Success criteria (acceptance)
1. Hammering `/api/ai/*` or `/api/discovery/*` past the configured window returns
   **429** with a clear message; normal use is unaffected. Limits are keyed by Clerk
   `userId` (authed) with a per-IP fallback.
2. A user who exceeds their **daily AI budget** is refused further paid AI calls with
   a clear "daily budget reached" 429 until the window resets; the ceiling is env-configured.
3. Contact-PII (email/phone/postal/URL) is **absent** from text sent to the LLM for
   parse/score and **masked** in Langfuse trace inputs/outputs and logs; skills and
   experience (what scoring needs) are preserved.
4. JD text containing injection attempts ("ignore previous instructions…", role
   overrides) is **delimited as data**, flagged on the trace, and does not alter
   extraction/scoring behavior; generated outreach passes a **moderation + groundedness**
   check before it is returned.
5. **Two-tier gate, honest about the push-only judge key.** Every PR runs a *key-free*
   gate — eval-metric unit tests + a **gold-set integrity** check + a **mock-model
   smoke run** of the runner — that **fails the build** on broken eval code, malformed
   gold data, or a broken pipeline. On **push-to-main** (where the provider key is
   available) the real eval runs and **fails the job** when parse-job F1 / title /
   seniority or fit-vs-label Spearman fall below committed thresholds, and **flags Ragas
   regressions** against a stored baseline. (A PR cannot gate *model quality* without
   exposing the judge key to PR code — the risk Phase 1 closed — so quality is gated at
   `main`; this is documented and the main gate is wired as a deploy gate.)
6. **Graceful degradation preserved:** no provider key → moderation/Ragas/LLM-based
   checks skip; no DB → rate/cost state falls back to in-memory; `npm run check` +
   agent `pytest`/`ruff` stay green.

## 4. Workstream G — API edge (`apps/api`, TS/Express)

- **Rate-limiting:** `express-rate-limit` middleware mounted in `app.ts` after auth so
  the key can be the Clerk `userId`, with a per-IP fallback for unauthed/demo paths.
  Two buckets: a strict one on the expensive routers (`/api/ai`, `/api/discovery`) and
  a lenient global one. Single App Service instance today → the default in-memory store
  is correct; a Redis/pg store is noted as the scale-out path (not built now).
- **Cost ceiling:** a per-user **daily spend counter** behind a small store following
  the existing pattern — `data/usage-store.ts` (file/in-memory) + `usage-store.postgres.ts`
  (prod), mirroring `saved-search-store`. The API estimates each paid AI call's cost
  (token usage is already surfaced on the agent/Langfuse path; fall back to a per-call
  flat estimate when token counts are unavailable) and increments the day's counter.
  When the env ceiling (`AI_DAILY_BUDGET_USD`, default e.g. `1.00`) is exceeded → **429**
  with `{ error: "Daily AI budget reached" }` before the agent is called. Reset is a
  UTC-day rollover keyed on `(user_id, yyyy-mm-dd)`.
- **Headers:** add `helmet` with a config compatible with the existing CORS setup.
- **Rejected alternative:** a hard global LLM kill-switch — too blunt; per-user daily
  ceiling protects spend without taking the whole app down.

## 5. Workstream H — Data privacy / PII (`services/agent` + TS seam)

- **Key nuance:** the resume's *skills/experience* must reach the LLM for fit scoring,
  so we do **not** blanket-redact. We strip **contact-PII** (email, phone, postal
  address, URLs) — irrelevant to parse/score — before the LLM call, and **mask** PII in
  observability.
- **Detector (`app/safety/pii.py`):** dependency-light **regex** redaction for
  email / phone / postal / URL / common-ID patterns, returning redacted text + a count
  of redactions by type. Microsoft **Presidio** is named as the documented heavier-NER
  alternative, deliberately **not** a Phase-2 dependency (same instinct that kept Ragas
  out of the runtime image).
- **Integration points:** (a) redact contact-PII from resume/JD text inside the
  parse/score chains before the LLM call; (b) a Langfuse input/output **scrubber** so
  trace payloads are masked; (c) mask in any app logging.
- **Retention:** a written stance in a privacy note — no raw resume text persisted
  beyond the active request/record, and a documented scrub path. No new long-term store
  is introduced by Phase 2.
- **Rejected alternative:** redact PII at the TS API only — insufficient, because the
  agent and tracing are where text actually reaches third parties; redaction must live
  closest to the LLM call.

## 6. Workstream I — LLM I/O guardrails (`services/agent`)

- **Prompt-injection defense:**
  - *Structural hardening* — wrap untrusted JD text in explicit delimiters and add a
    system instruction to treat delimited content as **data, never instructions**.
    Builds on the existing grounded prompts in `app/prompts.py`. Applies to parse-job
    and score-fit (the chains fed Adzuna-ingested JD text).
  - *Heuristic detector (`app/safety/injection.py`)* — scan JD text for injection
    signatures (instruction-override phrases, role markers, suspicious encoded blobs);
    on a hit, **flag the trace** and (configurable) sanitize or refuse. Structured-output
    schemas remain a final defense layer.
- **Output moderation (`app/safety/moderation.py`):** before a draft is returned, run
  **both** a safety **moderation** check and a **groundedness self-check** (the email
  cites only facts present in the job context / resume). Moderation is
  **provider-agnostic**: prefer OpenAI's moderation endpoint when an OpenAI moderation
  key exists (`OPENAI_API_KEY` or a dedicated `MODERATION_OPENAI_API_KEY`), otherwise
  fall back to a lightweight LLM safety self-check via the **active** provider
  (`get_model`) — so Anthropic/Azure/Gemini deployments are still moderated, not silently
  skipped. Both checks **skip** (allow) only when moderation is disabled or **no provider
  is configured at all** (consistent graceful degradation); groundedness uses the active
  provider. A blocked message is withheld with a `safety_notes` reason; unsupported claims
  are flagged in `safety_notes` (the draft is human-reviewed before sending).
- **Rejected alternative:** a full guardrails framework (e.g., NeMo Guardrails / Guardrails
  AI) — heavier dependency and config surface than this app needs; focused modules are
  more testable and read more clearly in the portfolio.

## 7. Workstream J — Eval gating + full `EVALS.md`

- **Constraint that shapes this:** the deterministic parse-job *metrics* are LLM-free,
  but *producing* the candidate parse still calls the LLM (`parse_job()`), so a PR with
  no provider key skips entirely. Quality therefore cannot be gated on PRs without
  re-exposing the judge key to PR code — the exact risk Phase 1 closed. Hence two tiers:
  - *PR gate (key-free, blocks merges via the existing `agent` pytest job).* Three pure
    checks: (1) the eval-metric **unit tests**; (2) a **gold-set integrity** test —
    every `parse_job.jsonl` / `fit_score.jsonl` row is well-formed (required keys,
    non-empty fields) and `sample_resume.txt` exists; (3) a **mock-model smoke run** that
    monkeypatches a fake model (the `_FakeModel` pattern already in `tests/test_tracing.py`)
    and drives `evals.run` end-to-end, asserting it produces a report. Catches broken
    eval code, malformed data, and pipeline breakage — no key, fully deterministic.
  - *Main quality gate (key present, on push-to-main in `evals.yml`).* Runs the real
    eval and **fails the job** when a metric drops below the committed threshold in
    `evals/thresholds.json` (seeded from current baselines minus a tolerance, e.g.
    F1 ≥ 0.50 given the 0.59 baseline). Adds **Ragas regression detection** vs
    `evals/baseline.json` (fail on a drop beyond tolerance). The gated run must **drop
    the existing `continue-on-error: true`** on the eval step (today it's report-only) —
    otherwise `main()` returning non-zero would still leave the job green and gate
    nothing. A red main gate is visible and is **wired as a deploy gate** (the deploy job
    checks the latest gate, documented).
- **`EVALS.md` (full):** methodology, datasets, the current metrics table, thresholds,
  how to run locally, the two-tier CI rationale, and the security note on why the judge
  key is injected only on push-to-main.
- **Rejected alternative:** re-expose the provider key to PR runs (via
  `pull_request_target` or a trusted-label gate) to gate the full Ragas suite on PRs —
  reintroduces the exact exfiltration risk Phase 1 closed; not worth it.

## 8. Cross-cutting

- **Config/secrets (no real values in `.env.example`):** rate-limit window/limits,
  `AI_DAILY_BUDGET_USD`, PII-redaction toggle, moderation toggle + optional
  `MODERATION_OPENAI_API_KEY` (falls back to the active provider when unset), gate
  thresholds path. Live values via App Service config (existing pattern); the eval CI
  key stays a push-only GitHub secret.
- **Testing:** API unit tests for the rate-limit middleware and the usage-store (file
  mode) + cost-ceiling 429 path; agent tests for the PII redactor, injection detector,
  and moderation wrapper (mocked judge, plus the no-key skip path); eval tests for the
  threshold-gate and regression-detection logic. Preserve all existing
  graceful-degradation tests.
- **Docs:** full `EVALS.md`; README/ARCHITECTURE updates (safety + privacy + gating);
  a privacy/retention note; cross-link the `cost-controls` doc as the complementary
  billing layer.

## 9. Risks & mitigations
- **Over-aggressive rate limits break normal use** → conservative defaults, per-route
  buckets, env-overridable; covered by tests.
- **PII regex misses / over-masks** → scope to high-precision contact patterns, count
  redactions for visibility, document Presidio as the upgrade path.
- **Injection detector false positives** → flag-and-trace by default; refuse only when
  explicitly configured; structured output limits blast radius.
- **Gate flakiness blocks merges** → deterministic metrics only on PRs (no network/LLM),
  thresholds set with tolerance below current baselines.
- **Cost estimate inaccuracy** → ceiling is a guardrail not billing; use token usage
  when present, conservative flat fallback otherwise; the Azure budget remains the
  backstop.
- **Scope creep** → LangGraph/hybrid-RAG/IaC explicitly deferred (§2).

## 10. SDLC / delivery
This spec → an implementation plan (`writing-plans`) → **detailed GitHub issues**: an
**epic** ("Phase 2 — Safety, guardrails & eval gating") plus four **sub-issues**
(G API edge, H PII, I LLM guardrails, J eval gating + docs), each with acceptance
criteria and task checklists, under a **`Phase 2` milestone** with labels
(`phase-2`, plus `security`/`privacy`/`evals`). Each sub-issue is delivered on its own
branch → PR (`Closes #…`) → green CI → **user merges**. TDD where it fits;
`npm run check` + agent `pytest`/`ruff` before every PR.
