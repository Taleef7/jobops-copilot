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

## Phase 3 — Make the flagship AI claims true 🚧 in progress

| Finding | Severity | Issue | PR |
| --- | --- | --- | --- |
| Eval sweep leaked the résumé to the generator → "~3× faithfulness" withdrawn | High | [#197](https://github.com/Taleef7/jobops-copilot/issues/197) | _this PR_ |
| Retrieval query is the raw JD: lexical side never fires, dense query truncated | High | [#198](https://github.com/Taleef7/jobops-copilot/issues/198) | _this PR_ |
| Skip re-embedding unchanged résumés; structured-output retry + clamp | Medium | [#199](https://github.com/Taleef7/jobops-copilot/issues/199) | _pending_ |
| Trace assistant/chat paths; injection-guard `draft_outreach` | Medium | [#200](https://github.com/Taleef7/jobops-copilot/issues/200) | _pending_ |

### What the eval correction found

The retrieval sweep passed `resume_text` to `score_fit` in **every** mode, and `score_fit`
puts it in the prompt unconditionally — so the `off` arm, documented as "JD only", always had
the whole résumé. Only the Ragas judge's contexts varied. The published "faithfulness
0.25 → 0.83, a ~3× gain" measured judge visibility.

The evidence was already in the published table: `off` scored the *highest* fit-vs-label
Spearman (0.705). A résumé-blind model cannot rank candidates. Corrected, that arm scores
**0.407**.

Two things came out of the re-measurement that are worth more than the original claim:

1. **A real result.** Four retrieved chunks recover whole-résumé quality (0.721/0.824 vs
   0.684/0.805) — retrieval buys context *efficiency*, not accuracy, on a prompt that already
   fits. That is the honest engineering justification.
2. **An honest measure of how noisy this eval is.** `hybrid` and `vector` retrieve
   byte-identical chunks on 16/16 rows (the lexical side matches 0/16 JDs — see #198) yet
   scored Δ0.058 Spearman / Δ0.098 faithfulness apart. One such pair only shows variance of
   that order *occurred*, so the spread is now measured properly: `--noise-floor 5` scores one
   fixed configuration five times. Result — Spearman sd 0.034 (range 0.721–0.797),
   faithfulness sd 0.039 (range 0.741–0.821). Even that understates it: the sweep's `hybrid`
   faithfulness (0.922) lands outside all five replicates despite being the same experiment,
   so the figures are a **floor on the spread, not a bound**. Only the retrieval-vs-nothing
   effect (4–9× the largest no-op movement) clears it; every other comparison in the table is
   *unresolved*, which is a limit of the measurement rather than a finding.

Structural fix: `evals/evidence.py` makes the generator's inputs and the judge's contexts
derive from one `Evidence` value, with a parametrized regression test that fails if they
diverge.

### …and what the #198 re-measurement then found

Fixing the harness was not enough: the gold résumé chunked into exactly **4** pieces and the
sweep retrieved **k=4**, so every "retrieval mode" returned the whole résumé in a different
order. Retrieval was never being measured. The résumé was expanded to 9 chunks (qualification
profile deliberately unchanged — most gold rationales turn on specific technologies being
*absent*), and with the lexical query fixed:

- **Lexical retrieval went from 0/16 to 16/16 JDs matching**, and hybrid now retrieves
  different chunks from vector on 13/16 rows. It is finally a real experiment.
- **Retrieval outranks the whole résumé**: `vector` 0.726 vs `full-resume` 0.586 Spearman —
  2.2× the noise floor, with `full-resume` below the entire 5-replicate range of `vector`.
  More context made the ranking *worse*; retrieval acts as a precision filter, not a
  compromise.
- **Hybrid/rerank vs vector stays unresolved** (Δ0.031, half the floor) — an honest null now
  rather than an impossibility.
- **The noise floor is corpus-specific.** Re-measured on the new gold set it moved from
  Spearman Δ0.076 → 0.063 and faithfulness Δ0.080 → **0.120**. Inheriting the old threshold
  would have mis-graded results in both directions. And for the second time a single sweep
  value landed outside five replicates of the same configuration — five replicates bound
  nothing; they estimate.

## Phase 4 — Polish & harden for scale 📋 planned

Assistant a11y/stream fixes; loading/error boundaries; pagination + externalized limiter/cache;
reconcile the Bicep with live reality; refresh remaining stale docs.
