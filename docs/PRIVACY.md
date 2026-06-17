# Privacy & PII handling

JobOps Copilot processes resumes, profiles, and job descriptions — text that can contain
personal data. This note documents how that data is handled (Phase 2 · Workstream H).

## What is collected

- **Resume / profile text** supplied by the user (skills, experience, and often contact
  details).
- **Job descriptions** ingested from Adzuna / Remotive or entered manually.

These power parsing, fit scoring, and outreach drafting. The fit assessment only needs a
candidate's *skills and experience*, not their contact details.

## Contact-PII is stripped before third-party LLMs

Before any text is sent to an LLM provider, the agent redacts high-precision **contact
PII** — email addresses, phone numbers, URLs, and US SSNs — replacing them with
placeholders (`[EMAIL]`, `[PHONE]`, `[URL]`, `[SSN]`). Skills, employers, dates, and
narrative experience are preserved, so analysis quality is unaffected.

- Implemented in `services/agent/app/safety/pii.py` (`redact_contact_pii`) and applied in
  the parse-job, score-fit, and draft-outreach chains.
- Phone matching is **digit-count filtered (10–15 digits)** so ISO dates, salaries, and
  ZIP-like numbers are not mistaken for phone numbers.
- **Out of scope (by design):** free-form street addresses and names are *not*
  auto-redacted — pattern-based detection there is low-precision and would harm analysis.
  Microsoft **Presidio** is the documented upgrade path if NER-grade redaction is needed.

## PII is masked in traces and logs

When Langfuse tracing is enabled, a `mask` function (`app/obs/langfuse.py` → the same
redactor, recursively over trace inputs/outputs) scrubs contact-PII before any trace
leaves the process, so observability never persists raw contact details.

## Toggle

Redaction is on by default and controlled by `PII_REDACTION_ENABLED` (default `true`).
Set it to `false` only in trusted/offline contexts where redaction is not wanted.

## Retention

- The app stores the user's own job records, analyses, and outreach drafts (the CRM) —
  this is the product's purpose and is scoped per user.
- No **separate** long-term store of raw resume text is introduced by Phase 2; resume
  text lives with the user's profile/records and is removed when those are deleted.
- Third-party LLM providers receive only the **redacted** text described above. Configure
  provider-side data-retention/zero-retention settings as appropriate for your deployment.

## No automated sending

Generated outreach is always **human-reviewed** before any send; the app never
auto-applies or auto-sends. See `docs/HUMAN_IN_THE_LOOP_POLICY.md`.
