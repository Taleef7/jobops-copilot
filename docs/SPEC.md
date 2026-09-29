# JobOps product spec

Status: target product. This describes what the app should become after the
staged prune, not what the code does today. When this file and the code
disagree, this file wins and the code gets an issue. The work to get there is
tracked in the epic #333.

## The product in one sentence

Tell me in 10 seconds if a job is worth applying to, give me an honest tailored
résumé, and never let me miss a follow-up.

## Who it is for

One person running their own job search: the owner, first. Clerk sign-in and
per-user data stay, so other people can sign up later without a rewrite, but no
feature is built for a team, a recruiter or an admin.

## The core loop

1. **Add a job.** Paste the posting text, or paste a URL and let the server
   extract title, company, location and description. The user reviews the
   fields before saving.
2. **Honest fit read.** Within 10 seconds: apply / maybe / skip, the reasons,
   matched and missing skills, and the hard signals (salary vs floor,
   sponsorship, location/remote), each marked "unknown" when the posting does
   not say.
3. **Tailored materials.** A tailored résumé (shown as a diff against the base
   résumé, approved by the user, exported as PDF), a cover letter, and answers
   to the application questions. All drafts, all editable.
4. **Apply.** The user applies on the employer's site, copying the approved
   answers. (Autofill via the Chrome extension is paused; see "Out of scope".)
5. **Track.** Status, next action and a follow-up date on every job. Marking a
   message sent or moving a job to `applied` sets a default follow-up
   (+5 business days) that the user can change or clear. The Pipeline shows
   what is due today.

Supporting features, kept but secondary:

- **Prep** on the Fit tab: interview prep (likely questions and talking points
  from the résumé) and a company brief (web search with cited sources).
  Both are generated on request.
- **Discovery:** saved searches (Adzuna) and target-company ATS boards, run on a
  schedule, with a "pull into pipeline" action.

## Honesty rules (non-negotiable)

1. **Never display invented data.** No fabricated contacts or emails, no
   placeholder or keyword-guess scores shown as real, no seed or mock data as a
   fallback when the API or database fails. An empty state is always better
   than a made-up one.
2. **When AI fails, say so.** Show the error and a Retry button. Persist
   nothing from a failed or invalid call. A response that fails zod validation
   counts as a failure. The same applies to ordinary saves: no success toast
   before the server confirms.
3. **Show the basis.** Every AI output shows what it was built from: which
   résumé version, which posting text (with a link or excerpt), which
   preferences, the model and the time.
4. **Unknown is a value.** A signal the posting does not state (salary,
   sponsorship, remote policy, seniority) is shown as "unknown", never as a
   number, a default or a guess.
5. **Nothing is sent automatically.** No emails, no messages, no form submits.
   The app drafts; the user sends and then logs it.
6. **Tailoring only rephrases and reorders.** A tailored résumé may reword,
   reorder, trim or emphasise facts that are in the base résumé. It may not add
   employers, titles, dates, degrees, skills, metrics or tools. Every tailored
   bullet maps to a source bullet, and any line without a source is flagged and
   blocked from export. Tailoring is disabled, with a clear message, while the
   base résumé is empty or unconfirmed.
7. **Legal and money answers come only from the user.** Work authorization
   (per country), visa sponsorship, salary expectation (desired, never
   "current" unless entered as such), relocation, and demographic or EEO
   answers are filled only from values the user entered. If a value is
   missing, the answer stays blank and flagged. Never derive these from the job
   posting or guess a default.

## Information architecture

Three navigation items (Pipeline, Discover, Settings) plus the job page. No
global assistant, no notifications bell, no dashboard or reports pages.

Signed out, `/` is a one-screen landing page. Signed in, `/` redirects to
`/jobs`. First run: upload résumé → confirm the parsed roles → preferences →
first saved search → Discover.

### Pipeline (home, `/jobs`)

- **Purpose:** see every active job and what needs doing today.
- **On it:**
  - a "Due today" strip (follow-ups due or overdue, with the next action);
  - a one-line funnel (saved → applied → interviewing → offer, with counts), hidden until the first application;
  - the job list as a table, filterable by status. The default filter hides rejected and archived; there's an "Unsent drafts" filter.
  - Each row shows company, title, fit verdict, status, next action, follow-up date and a message count.
- **Primary action:** Add job (opens paste text / paste URL).
- **Empty state:** "No jobs yet. Add one by pasting a posting or its URL." with
  the Add job button. It says "N new on Discover" when discovery has results, and
  links to Settings if no résumé is uploaded.

### Job page (`/jobs/[id]`)

A header (title, company, location, posting link) with three tabs and a right
rail. On narrow screens the rail moves above the tabs and the tabs scroll
horizontally. Tab content keeps its state when switching tabs.

**Right rail:** status (select), next action (short text), follow-up date
(date only), notes. Changes save immediately. When the status is
`interviewing`, the rail links to Prep.

**Fit tab**

- **Purpose:** decide whether to apply.
- **On it:** the verdict sentence first, then the reasons, matched and missing
  skills (short labels, evidence on demand), the hard signals with "unknown"
  where applicable, and a muted "based on" line. Below it, Prep: interview prep
  and a company brief with sources, each generated on request.
- **Primary action:** Run fit (or Re-run fit after the posting or résumé
  changed).
- **Empty state:** "Not analysed yet." with Run fit. If there is no base résumé:
  "Upload your résumé in Settings to get a fit read."

**Apply tab**

- **Purpose:** produce the materials to apply with.
- **On it:**
  - tailored résumé (diff view against base, approve, download PDF);
  - cover letter (editable draft, PDF);
  - application answers (question, draft answer, "needs review" flag until the user edits or confirms it).

  Each shows its "based on" line and version history.
- **Primary action:** Tailor résumé.
- **Empty state:** "Nothing drafted yet." with Tailor résumé. Blocked with an
  explanation when the base résumé is empty.

**People & Messages tab**

- **Purpose:** keep track of who you talked to about this job.
- **On it:** contacts the user added by hand (name, role, link, how they know
  them); message drafts for a chosen contact, with a length limit per channel;
  a sent log where the user marks a draft as sent (with date and channel) after
  sending it themselves.
- **Primary action:** Add contact.
- **Empty state:** "No contacts for this job. Add someone you know or found
  yourself." The app does not search for people.

### Discover (`/discover`)

- **Purpose:** find new postings without leaving the app.
- **On it:**
  - saved searches (keywords, location, remote), each with its last-run time and new/duplicate counts;
  - target companies (name, ATS and board slug, validated on add);
  - a results list of new postings, with bulk select.

  No AI score at ingest: a posting gets a fit read once it is pulled into the pipeline.
- **Primary action:** Pull into pipeline (single or bulk); Dismiss for the rest.
  Dismissed and archived postings never come back.
- **Empty state:** "No saved searches or target companies yet." with Add search
  and Add company.

### Settings (`/settings`)

- **Résumé:** upload (PDF; DOCX later), parsed into a structured base résumé.
  Parsed roles are confirmed by the user before they are used. The résumé is
  shown as a read view with per-section edit. This is the only source of truth for tailoring.
- **Preferences:** target roles, salary floor and currency, sponsorship need,
  work authorization per country, relocation, locations and remote preference,
  and optional EEO answers. Every field may be "not set". These are used by the
  fit read and the application answers.
- **Saved answers:** answers the user confirmed for recurring application
  questions, reused in the Apply tab.
- **Data:** export everything as JSON; delete all data (with a typed
  confirmation).
- **Empty state:** first visit shows the résumé upload first, since nothing else
  works without it.

## Data model sketch

All user-owned tables carry a non-null `user_id` (the Clerk user id), including
job-scoped tables, and every query filters on it directly, not only through
`job_id`. Today `outreach` has no `user_id` (it is scoped through `jobs`) and
`resume_versions.user_id` is nullable. Both are fixed by a forward migration that
backfills from `jobs`, landing with the first issue that migrates those tables
(C2 for `outreach`).

| Table | Purpose | Key fields |
| --- | --- | --- |
| `user_profiles` | One row per user: uploaded résumé text and metadata | `user_id`, `resume_text`, `resume_file_name`, `updated_at` |
| `resume_versions` | The base résumé (`is_base`) and tailored versions | `user_id`, `job_id` (null for base), `structured_resume` (jsonb), `change_details`, `approved`, `is_base`, `file_url` |
| `preferences` | Inputs to the fit read and answers | `user_id`, `target_roles[]`, `salary_floor`, `currency`, `needs_sponsorship`, `work_auth` (jsonb per country), `relocation`, `locations[]`, `remote_pref`, `eeo` (jsonb, optional) |
| `jobs` | One row per posting | `id`, `user_id`, `title`, `company`, `location`, `job_url`, `canonical_url`, `description`, `source` (manual / url / discovery), `status`, `next_action`, `next_action_due`, `notes`, `applied_at`, `dismissed_at` |
| job analysis | AI output per job: the fit read, with verdict, reasons and `based_on` (on the job row or a table, decided in C6/E1) | `verdict`, `reasons`, `sub_signals` (nullable = unknown), `based_on`, `model`, `created_at` |
| `agent_outputs` | Prep and apply-pack outputs per job | `user_id`, `job_id`, `kind` (interview_prep / research / application_pack), `payload`, `model`, `created_at` |
| `outreach` | Message drafts, cover letters and the sent log | `user_id`, `job_id`, `contact_id`, `message_type` (incl. `cover_letter`), `status` (draft / sent / skipped), `sent_at`, `channel` |
| `job_contacts` | People the user added by hand | `user_id`, `job_id`, `name`, `role`, `link`, `note` |
| `application_answers` | Saved answers to recurring questions (user-level) | `user_id`, `question_hash`, `question`, `answer`, `category` |
| `saved_searches` | Discovery queries | `user_id`, `query`, `location`, `remote_only`, `last_run_at` |
| `target_companies` | ATS boards to watch | `user_id`, `company`, `board_type`, `board_token`, `enabled`, `last_run_at` |

**Job status** is one clean enum: `new` (found by discovery, shown only on
Discover), `saved`, `applied`, `interviewing`, `offer`, `rejected`, `archived`.
"Follow-up due" is derived from `next_action_due`, not stored as a status.
Outreach state (drafted, sent, skipped) lives on `outreach`, not on the job.
The old `outreach_drafted`, `outreach_sent`, `referral_requested` and
`follow_up_due` statuses are migrated away.

## Target architecture

- **Two apps.** Next.js web (`apps/web`) and the Express API (`apps/api`). The
  web calls the API through its server-side proxy with the user's Clerk token.
  There's no shared-secret impersonation header, and the proxy only forwards known
  API paths, with size and time limits. Folding Express into Next is not
  planned; revisit only if running two apps becomes a real cost.
- **No Python service.** LLM calls live in a TypeScript `ai/` module in the API,
  using one provider SDK. Each call (parse job, fit, interview prep, company
  brief, résumé parse, tailor, cover letter, answers, message draft) has a
  prompt and a zod schema for structured output. Invalid output is an error.
  The model name comes from an env var, and a deploy canary makes one real call.
- **Postgres only.** Azure Database for PostgreSQL in production, Docker
  Postgres locally and in tests. No JSON-file store, no seed fallback.
  Migrations are forward-only, numbered at merge time, and never edited once
  applied.
- **Auth:** Clerk, currently on a development instance (personal use). Moving to
  a production instance needs a custom domain and happens before anyone else
  is invited.
- **One scheduler:** a GitHub Actions cron calls one protected endpoint
  (`CRON_SECRET`, constant-time compare). It runs discovery and the liveness
  sweep as single-flight, bounded runs, and a failed run fails the workflow.
- **Hosting:** Azure App Service for web and API (`NODE_ENV=production`),
  Azure Postgres with the firewall limited to the App Service outbound IPs (no
  `0.0.0.0` rule), Application Insights as the only observability tool, with
  alerts on 5xx and canary failure.

## Out of scope until needed

| Cut or paused | Bring back when… |
| --- | --- |
| Chrome extension autofill (**paused**) | The core loop has been used for real applications for a few weeks. It returns with correct job matching, a hardened page-to-extension boundary, fills only approved values into visible fields, and a real setup path. The parked issues X01–X05 (#334–#338) are the starting point. |
| Clerk production instance (#340) | Before inviting any other user (needs a custom domain). |
| Floating/global assistant chat, `/assistant` page | The owner repeatedly wants to ask free-form questions across jobs that the job page cannot answer; then build one assistant. |
| Notifications (Telegram, push, email digest) | The "Due today" strip is not enough and follow-ups are being missed. |
| Weekly reports, dashboard KPI tiles | The owner wants a trend view the Pipeline funnel cannot give. |
| Today's Best feed and outcome ranking | There are enough outcomes for a ranking to mean something. |
| `/outreach` kanban | The Pipeline's "Unsent drafts" filter and the per-job sent log aren't enough. |
| n8n / Make / Zapier | A real integration is needed that one cron endpoint cannot do. |
| MCP server | The owner wants to drive the app from another AI tool day to day. |
| RAG / pgvector / reranker | Base résumés or job history outgrow what fits in one prompt. |
| EV telemetry demo, `/architecture` page | Never in this product. |
| Evals / Ragas | Fit or tailoring quality regresses and a fixed test set is needed to catch it. |
| k6 load tests, Langfuse | Real users beyond the owner produce measurable load, or App Insights cannot explain an AI cost or quality problem. |
| Connection scout (automated people search) | There is a source of real, verifiable contacts. |
| Skill-gap plans | The owner keeps building learning plans by hand. |
| AI scoring at discovery ingest | Pulling into the pipeline and running fit is too slow for the volume. |
| Gmail drafts, priority field, demo/sample data | A clear need appears. |
| Multi-provider LLM switching | The chosen provider becomes unreliable or too expensive. |
| Express → Next consolidation (#339) | Running two apps becomes a real cost. |

## Quality bar

- Every PR passes lint, typecheck and tests (`npm run check`, `npm test`).
- An authenticated Playwright smoke test runs in CI (Clerk testing token,
  Postgres service, AI mocked at the HTTP boundary): add job → fit → tailor →
  approve and download PDF → status change → follow-up date. It fails on any
  console error.
- AI calls are tested with recorded fixtures, including the failure path
  (error shown, nothing persisted).
- The PDF output is tested: no clipped lines, multi-page, Unicode text intact.
- Every page is usable at 375px wide with no sideways scroll.
- No text smaller than 12px; body and button text meet WCAG AA contrast.
- The core loop can be done with the keyboard alone, with visible focus;
  Escape closes every popover, select and dialog.
- No page renders data that did not come from the database or a successful AI
  call.

## Success =

- The owner tracks every real application in the app for 4 straight weeks,
  with no side spreadsheet.
- The fit read returns in under 10 seconds (p50) for a pasted posting.
- A tailored résumé needs under 5 minutes of edits before it is sent, and
  contains no line the owner has to delete for being untrue.
- No follow-up in those 4 weeks is missed past its date.
- Discovery never inserts the same posting twice.
- AI spend stays under the $1/day budget.
