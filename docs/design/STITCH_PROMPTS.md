# Google Stitch — Redesign Prompts for JobOps Copilot

Use these in Google Stitch (stitch.withgoogle.com). First set the **Design System**
once, then generate each screen with its prompt. Generate as **Desktop**, then use
Stitch's "make responsive / mobile variant" on each.

A Stitch project + this design system have already been created via MCP:
**Project:** "JobOps Copilot — AI Job Search Platform". Open it in Stitch to iterate.

---

## 1) Design System settings (set first)

- **Mode:** Light
- **Color variant:** Vibrant
- **Primary / seed:** `#10B981` (emerald) · **Secondary:** `#6366F1` (indigo) · **Tertiary:** `#F59E0B` (amber)
- **Headline font:** Plus Jakarta Sans · **Body/Label font:** Inter
- **Roundness:** 12px

**Design instructions (paste into the Design/“Design MD” box):**
> A calm, modern AI operations console. Glanceable and visual-first with minimal text — every screen understandable in 3 seconds via visual indicators (status pills with a leading dot, circular fit-score rings, sparklines, skill chips, icons), never paragraphs. Linear + Vercel dashboard polish, friendly and sustainable. Emerald = primary actions/positive; indigo = AI/agent features; amber = review/warning. Near-white rounded-12px cards on a soft gray canvas, soft ambient shadows, no hard 1px borders — separate with whitespace. Persistent left sidebar (icons + labels) on desktop, icon rail on tablet, bottom tab bar on mobile; fully responsive, ~1200px content width. Reusable components: fit-score ring (≥80 emerald / 65–79 amber / <65 rose), status pill, skill chips (matched = emerald + check, missing = rose + plus), sparkline with a highlighted anomaly dot, indigo agent cards, KPI tiles (big number + trend arrow + sparkline). 150–200ms hover/expand transitions; skeleton shimmer while AI runs. WCAG AA; never rely on color alone.

---

## 2) Dashboard / Overview

> Design the main Dashboard for "JobOps Copilot". Left: sidebar nav with logo and line-icon items Dashboard (active), Jobs, Outreach, Reports, Telemetry, Settings; avatar bottom. Top bar: search, primary emerald "+ Add job" button, notifications bell. Main area = responsive bento grid of rounded cards: (1) four KPI tiles — Jobs tracked 24, Avg fit score 72 with a small emerald ring, Outreach drafts 6, Follow-ups due 3, each with a trend arrow + tiny sparkline; (2) wide "Pipeline" card with a horizontal funnel Discovered→Shortlisted→Applied→Outreach→Interview→Offer as colored segments with counts; (3) "Pipeline telemetry" card with a 14-day sparkline, one amber anomaly dot, a "Trend: rising" chip, a one-line AI insight, and a secondary "EV battery demo" button; (4) "Top missing skills" card with 4 horizontal mini bars; (5) "Recent jobs" card with 3 rows each showing company + role, status pill, and a fit-score ring. Minimal text, soft shadows, generous whitespace.

## 3) Jobs list

> Design the Jobs list screen. Sticky toolbar: search, filter chips (Status, Priority, Fit ≥), a sort dropdown, and a view toggle (table / board). Default = a clean table with columns: Company + role (with tiny logo monogram), Status (pill), Fit (small ring or colored number), Priority (dot), Next action (date), and a kebab menu. Rows have hover elevation. Include a compact board/kanban alternative grouped by status. Add an empty-state illustration. Visual-first, minimal text, emerald primary actions.

## 4) Job detail

> Design the Job detail screen. Sticky summary header: company + role, location/type chips, a large fit-score ring, a status pill, and primary actions "Parse", "Score fit", "Generate outreach". Below, a tabbed area: **Analysis** (matched skills as emerald check-chips, missing skills as rose plus-chips, ATS keywords as chips, a short fit summary, recommended resume angle, and small confidence + model badges); **AI Agents** (three indigo agent cards — Interview prep, Research company, Skill-gap plan — each with an icon, one-line purpose, and a run button; results render as compact chip/list groups, research shows a "web search used" badge); **Outreach** (draft cards with a status pill, draft-only notice, approve/skip controls); **Telemetry** (a small trend chart for this job's activity). Right rail: editable CRM fields (status, priority, notes, next action). Minimal text, lots of visual indicators.

## 5) Outreach inbox

> Design the Outreach inbox as a kanban board with four columns — Drafted, Approved, Sent, Skipped — each column header showing a count. Cards show contact name + role, the job/company, a message-type chip (recruiter / referral / follow-up), a 2-line preview, and quick actions (approve, edit, skip). A clear banner reads "Drafts only — nothing sends without your approval." Emerald approve, amber skip. Drag-and-drop affordance. Minimal text.

## 6) Reports / Weekly

> Design the Weekly Reports screen. Header with a week selector and "Generate report" button. A summary band of KPI tiles (discovered, applied, outreach sent, responses, interviews) with week-over-week trend arrows. A line/bar chart of pipeline activity over the last several weeks. A "Common missing skills" bar list. A "Recommendations" card rendered as a short checklist (not a paragraph). A history list of past reports with a download (markdown) icon.

## 7) Telemetry intelligence

> Design a Telemetry screen showing time-series intelligence. A large chart of pipeline activity over time with anomaly points highlighted in amber and a forecast segment shown dashed. Stat tiles for Trend, 7-pt average, Forecast, and Anomalies count. An AI-narrated insight card (one short paragraph max) with a list of recommendations. A clearly-labeled "EV battery state-of-health demo" toggle that swaps the data to a synthetic vehicle-telemetry series with an injected anomaly — same chart + analysis — to show the pattern transfers to vehicle data.

## 8) Add / Create job

> Design a streamlined "Add job" screen (or modal). A single focused column: paste-job-description textarea up front, then minimal fields (company, title, URL, location, priority). A primary emerald "Save & analyze" button that implies it will auto-parse and score. Show a subtle hint that AI will extract the rest. Keep it short — no long forms.

## 9) Settings

> Design a Settings screen with grouped sections as cards: Profile/resume (upload + current resume chip), AI provider (segmented control: Claude / Azure OpenAI / OpenAI / Gemini with a "connected" status dot), Integrations (Gmail drafts toggle, n8n webhook), and Data (Postgres status, export). Use toggles, status dots, and segmented controls instead of text. Minimal copy.

---

## Tips for iterating in Stitch
- Generate Desktop first; then ask Stitch to "create a responsive mobile version with a bottom tab bar."
- If a screen is too text-heavy, re-prompt: "reduce text, replace descriptions with icons + one-line captions, add more visual indicators."
- Keep the same Design System selected on every screen for consistency.
- Export to code/Figma from Stitch when you're happy, then port into `apps/web` (Next.js + the existing component slots: status pill, fit ring, agent panel, telemetry panel).
