# AI JobOps Copilot — Project Implementation Plan

## 1. Project Overview

AI JobOps Copilot is a cloud-enabled, agentic job-search operations system. The goal is to transform job searching from a manual, scattered process into a structured CRM-style workflow powered by automations, AI agents, and cloud services.

The project should demonstrate practical proficiency with:

* n8n workflow automation
* Zapier automations
* Make.com scenarios
* AI agents and LLM-powered workflows
* Azure cloud services
* CRM-style database design
* React/Next.js dashboard development
* Serverless backend APIs
* Human-in-the-loop approval workflows
* Responsible AI automation
* Job-search analytics and weekly reporting

This project should not be positioned as a spammy “AI applies to jobs automatically” tool. Instead, it should be positioned as a responsible AI operations assistant that helps with job discovery, job analysis, resume-fit evaluation, outreach drafting, follow-up tracking, and weekly strategy reporting, while keeping the human in control of applications and messages.

## 2. Final Product Vision

The final system should allow a user to:

1. Add job opportunities manually or through automation.
2. Parse job descriptions into structured fields using AI.
3. Compare each job against the user’s resume/profile.
4. Generate a fit score and skill-gap analysis.
5. Recommend truthful resume-tailoring improvements.
6. Draft LinkedIn, recruiter, referral, and follow-up messages.
7. Store all jobs in a CRM-style dashboard.
8. Track application statuses and next actions.
9. Create follow-up reminders.
10. Generate weekly reports summarizing applications, outreach, responses, interviews, missing skills, and next priorities.
11. Demonstrate n8n as the primary automation orchestrator.
12. Demonstrate Zapier and Make.com as companion automation platforms.
13. Use Azure cloud services for hosting, storage, serverless APIs, and observability.

## 3. Project Positioning

### One-line description

AI JobOps Copilot is an Azure-hosted AI automation CRM that helps job seekers discover, analyze, prioritize, and manage job opportunities using n8n workflows, AI agents, and human-approved outreach automation.

### Portfolio description

AI JobOps Copilot is a cloud-enabled job search automation system built with React, Azure Functions, Azure Blob Storage, a CRM-style database, n8n workflows, Zapier, Make.com, and LLM-powered agents. It extracts job requirements, scores resume fit, recommends truthful resume optimizations, drafts recruiter/referral outreach with human approval, tracks application status, schedules follow-ups, and generates weekly analytics reports.

### Resume bullet draft

Built AI JobOps Copilot, an Azure-hosted job search automation CRM using React, Azure Functions, Azure Blob Storage, n8n, Zapier, Make.com, and LLM agents to automate job parsing, resume-fit scoring, outreach drafting, follow-up tracking, and weekly reporting with human-in-the-loop approval.

## 4. Core Design Principles

### 4.1 Human-in-the-loop by default

The system should generate recommendations, drafts, and reports. It should not automatically submit applications or send emails without explicit user approval.

### 4.2 Truthful resume tailoring only

The resume agent must not invent experience. It may suggest rewording, reordering, or emphasizing existing experience, but it must flag anything that requires manual review.

### 4.3 CRM-first architecture

The database should be the source of truth. Every automation should write structured records to the CRM database.

### 4.4 Automation as operations infrastructure

The system should demonstrate business-process automation, not just prompt engineering. Automations should move data between systems, update statuses, generate reports, and trigger next actions.

### 4.5 Cloud-native portfolio value

Azure should be used visibly and intentionally. The project should demonstrate cloud APIs, storage, hosting, and monitoring.

## 5. Recommended Technology Stack

### Frontend

* React or Next.js
* TypeScript
* Tailwind CSS
* shadcn/ui or similar component library
* Recharts for analytics/dashboard charts

### Backend

* Azure Functions using Node.js/TypeScript or Python
* REST API endpoints for job parsing, fit scoring, outreach generation, and weekly reporting
* Optional: Express/FastAPI locally during early development, then deploy to Azure Functions

### Database

Recommended options:

* Supabase PostgreSQL for fastest MVP
* Azure Database for PostgreSQL for stronger Azure alignment
* Azure SQL if the goal is to demonstrate Microsoft enterprise cloud familiarity

For the first MVP, Supabase is acceptable because it is fast and easy. Later, add an Azure deployment note or migration path.

### Storage

* Azure Blob Storage

Use Blob Storage for:

* uploaded resumes
* job description snapshots
* generated resume PDFs
* weekly report PDFs/HTML files
* exported workflow artifacts

### Automation

* n8n as the primary orchestrator
* Zapier for companion business-user automations
* Make.com for visual scenario automation and comparison

### AI Layer

Possible providers:

* OpenAI API
* Azure OpenAI if available
* Google Gemini API
* Anthropic Claude API

Use structured JSON outputs wherever possible.

### Integrations

* Gmail for draft emails and summaries
* Google Calendar for follow-up reminders
* Google Drive optional, but Azure Blob Storage should be primary for cloud portfolio value
* LinkedIn/job board input initially manual or semi-manual
* Apify or job scraping sources can be added later carefully

## 6. High-Level Architecture

```text
User
  |
  v
React/Next.js Dashboard
  |
  v
Azure Functions API
  |        |        |
  |        |        +--> LLM Provider for parsing/scoring/drafting/reporting
  |        |
  |        +--> Azure Blob Storage for resumes, job descriptions, reports
  |
  +--> CRM Database: jobs, analyses, outreach, resume versions, reports

n8n Workflows
  |
  +--> Scheduled job discovery
  +--> AI processing workflow
  +--> Gmail draft workflow
  +--> Calendar follow-up workflow
  +--> Weekly report workflow

Zapier Companion Flows
  |
  +--> Gmail/Calendar/Sheets lightweight automations

Make.com Companion Scenarios
  |
  +--> Visual job-added-to-notification scenario
```

## 7. MVP Scope

The first MVP should not include scraping, auto-apply, or complex contact discovery. The goal is to lay a clean foundation.

### MVP must include

1. Project repo structure.
2. Frontend dashboard scaffold.
3. Backend API scaffold.
4. Database schema and migration files.
5. Azure-ready environment configuration.
6. Manual job creation form.
7. Job listing table with status tracking.
8. Job detail page.
9. AI job parsing endpoint placeholder.
10. AI fit scoring endpoint placeholder.
11. Outreach draft endpoint placeholder.
12. Weekly report endpoint placeholder.
13. Documentation folder with architecture and implementation notes.
14. n8n workflow documentation placeholders.
15. Zapier/Make companion workflow documentation placeholders.

### MVP should avoid initially

* Fully automated LinkedIn scraping.
* Auto-sending emails.
* Auto-submitting job applications.
* Overcomplicated authentication.
* Complex multi-user support.
* Payment integration.
* Salary negotiation automation.

## 8. Suggested Repository Structure

```text
ai-jobops-copilot/
  README.md
  .env.example
  .gitignore
  package.json
  docs/
    PROJECT_IMPLEMENTATION_PLAN.md
    ARCHITECTURE.md
    DATABASE_SCHEMA.md
    API_SPEC.md
    AUTOMATION_WORKFLOWS.md
    AZURE_DEPLOYMENT.md
    HUMAN_IN_THE_LOOP_POLICY.md
    ROADMAP.md
    CODEX_NOTES.md
  apps/
    web/
      package.json
      src/
        app/
        components/
        lib/
        hooks/
        types/
    api/
      package.json
      src/
        functions/
        services/
        lib/
        types/
  db/
    migrations/
    seed/
  workflows/
    n8n/
      README.md
      exports/
    zapier/
      README.md
    make/
      README.md
  prompts/
    job-parser.md
    fit-scorer.md
    resume-tailor.md
    outreach-drafter.md
    weekly-report.md
  samples/
    job-descriptions/
    resumes/
    reports/
  scripts/
```

## 9. Core Data Model

### 9.1 jobs table

Stores every job opportunity.

Fields:

* id: UUID primary key
* job_url: text, nullable but unique when present
* source: text
* company: text
* title: text
* location: text
* employment_type: text
* workplace_type: text, e.g. remote, hybrid, onsite
* date_posted: timestamp nullable
* discovered_at: timestamp
* description_text: text
* status: text
* priority: text
* fit_score: integer nullable
* notes: text nullable
* created_at: timestamp
* updated_at: timestamp

Suggested status values:

* discovered
* shortlisted
* applied
* outreach_drafted
* outreach_sent
* referral_requested
* follow_up_due
* interview
* rejected
* offer
* archived

### 9.2 job_analysis table

Stores AI-generated analysis of a job.

Fields:

* id: UUID primary key
* job_id: foreign key to jobs.id
* required_skills: JSON/text array
* preferred_skills: JSON/text array
* matched_skills: JSON/text array
* missing_skills: JSON/text array
* ats_keywords: JSON/text array
* fit_summary: text
* recommended_resume_angle: text
* apply_recommendation: text
* confidence_score: integer nullable
* model_used: text
* created_at: timestamp

### 9.3 outreach table

Stores generated outreach messages and contact attempts.

Fields:

* id: UUID primary key
* job_id: foreign key to jobs.id
* contact_name: text nullable
* contact_role: text nullable
* contact_source: text nullable
* linkedin_url: text nullable
* email: text nullable
* message_type: text
* draft_text: text
* status: text
* gmail_draft_id: text nullable
* created_at: timestamp
* sent_at: timestamp nullable
* follow_up_due: timestamp nullable

Suggested message_type values:

* recruiter_email
* linkedin_connection
* referral_request
* follow_up
* thank_you

Suggested outreach status values:

* drafted
* approved
* sent
* skipped

### 9.4 resume_versions table

Tracks resume versions and tailoring suggestions.

Fields:

* id: UUID primary key
* job_id: foreign key to jobs.id
* base_resume_file_url: text
* tailored_resume_file_url: text nullable
* change_summary: text
* approved: boolean
* created_at: timestamp

### 9.5 weekly_reports table

Stores weekly analytics outputs.

Fields:

* id: UUID primary key
* week_start: date
* week_end: date
* jobs_discovered: integer
* jobs_shortlisted: integer
* jobs_applied: integer
* outreach_drafted: integer
* outreach_sent: integer
* responses_received: integer
* interviews: integer
* common_missing_skills: JSON/text array
* recommendations: text
* report_url: text nullable
* created_at: timestamp

## 10. API Design

### 10.1 Job APIs

#### GET /api/jobs

Returns all jobs, optionally filtered by status, source, company, priority, or date range.

#### POST /api/jobs

Creates a new job manually.

Expected body:

```json
{
  "job_url": "https://example.com/job",
  "source": "manual",
  "company": "Example Company",
  "title": "AI Automation Engineer",
  "location": "Remote",
  "employment_type": "Full-time",
  "description_text": "Full job description here"
}
```

#### GET /api/jobs/:id

Returns one job with its analysis, outreach messages, and resume versions.

#### PATCH /api/jobs/:id

Updates job fields such as status, priority, notes, fit_score, or follow-up date.

#### DELETE /api/jobs/:id

Archives or deletes a job depending on implementation preference.

### 10.2 AI APIs

#### POST /api/ai/parse-job

Parses a raw job description into structured data.

Input:

```json
{
  "job_id": "uuid",
  "description_text": "..."
}
```

Output:

```json
{
  "company": "...",
  "title": "...",
  "required_skills": [],
  "preferred_skills": [],
  "responsibilities": [],
  "seniority": "...",
  "cloud_tools": [],
  "automation_tools": [],
  "summary": "..."
}
```

#### POST /api/ai/score-fit

Scores the job against the user profile/resume.

Input:

```json
{
  "job_id": "uuid",
  "resume_text": "...",
  "profile_text": "..."
}
```

Output:

```json
{
  "fit_score": 82,
  "matched_skills": [],
  "missing_skills": [],
  "ats_keywords": [],
  "fit_summary": "...",
  "recommended_resume_angle": "...",
  "apply_recommendation": "apply"
}
```

#### POST /api/ai/draft-outreach

Creates outreach drafts.

Input:

```json
{
  "job_id": "uuid",
  "message_type": "recruiter_email",
  "contact_name": "Optional Name",
  "contact_role": "Optional Role"
}
```

Output:

```json
{
  "subject": "...",
  "draft_text": "...",
  "safety_notes": "..."
}
```

#### POST /api/ai/generate-weekly-report

Generates weekly analytics and recommendations.

Input:

```json
{
  "week_start": "2026-05-11",
  "week_end": "2026-05-17"
}
```

Output:

```json
{
  "summary": "...",
  "metrics": {},
  "common_missing_skills": [],
  "recommended_next_actions": [],
  "report_markdown": "..."
}
```

## 11. Frontend Dashboard Pages

### 11.1 Dashboard Home

Should show:

* total jobs discovered
* total shortlisted
* total applied
* total outreach drafts
* interviews scheduled
* average fit score
* applications by status
* follow-ups due
* top missing skills

### 11.2 Jobs Page

Should include:

* searchable/filterable jobs table
* filters by status, company, source, priority, fit score
* quick status update
* add job button

### 11.3 Add Job Page

Should allow:

* paste job URL
* paste job description
* enter company/title manually
* submit to CRM
* optional “analyze with AI” action

### 11.4 Job Detail Page

Should show:

* job metadata
* full description
* AI analysis
* fit score
* matched skills
* missing skills
* recommended resume angle
* outreach drafts
* status history
* notes
* next action

### 11.5 Outreach Page

Should show:

* all drafted messages
* message type
* job/company
* status
* approve/send manually workflow status

### 11.6 Reports Page

Should show:

* weekly reports
* metrics over time
* common missing skills
* recommendations

### 11.7 Settings Page

Should eventually show:

* target role queries
* preferred locations
* resume/profile upload
* LLM provider configuration status
* automation webhook status

## 12. Prompt Files

Prompts should live in the `/prompts` folder so the project demonstrates prompt engineering discipline.

### 12.1 job-parser.md

Purpose:

Convert raw job descriptions into structured JSON.

Important requirements:

* Return valid JSON only.
* Extract explicit information when present.
* Use null when information is not available.
* Do not infer too aggressively.
* Identify automation tools, cloud tools, AI tools, programming languages, and soft skills separately.

### 12.2 fit-scorer.md

Purpose:

Compare the job against the user’s resume/profile.

Important requirements:

* Do not fabricate experience.
* Explain score clearly.
* Separate strong matches from weak matches.
* Identify missing keywords.
* Recommend whether the user should apply.

### 12.3 resume-tailor.md

Purpose:

Suggest truthful resume improvements.

Important requirements:

* Do not invent experience.
* Suggest edits using only the resume/profile evidence.
* Return original bullet, suggested bullet, rationale, and risk level.
* Flag claims requiring manual verification.

### 12.4 outreach-drafter.md

Purpose:

Draft human-sounding outreach messages.

Important requirements:

* Keep messages concise.
* Avoid exaggerated claims.
* Personalize based on job/company/contact context.
* Never claim the user has already applied unless status confirms it.
* Never send automatically.

### 12.5 weekly-report.md

Purpose:

Generate weekly strategy reports from CRM data.

Important requirements:

* Summarize metrics.
* Identify bottlenecks.
* Recommend concrete next actions.
* Highlight recurring missing skills.
* Keep the tone direct and strategic.

## 13. n8n Workflow Plan

### 13.1 Workflow A: Manual Job Intake Processing

Trigger:

* Webhook from frontend after a job is created

Steps:

1. Receive job_id.
2. Fetch job from API.
3. Call parse-job endpoint.
4. Store parsed analysis.
5. Call score-fit endpoint if resume/profile exists.
6. Update job fit score and priority.
7. Send notification/email summary.

### 13.2 Workflow B: Daily Job Discovery

Trigger:

* Scheduled trigger at 7:00 AM

Steps:

1. Load target search queries.
2. Fetch fresh job postings from configured source.
3. Filter jobs posted in the last 24–48 hours.
4. Deduplicate using job_url.
5. Create new job records.
6. Trigger Workflow A for each new job.
7. Send morning digest.

This workflow can initially be documented but not fully implemented until the CRM and AI parsing foundation is stable.

### 13.3 Workflow C: Outreach Drafting

Trigger:

* User clicks “Generate Outreach” in dashboard or status changes to shortlisted/applied

Steps:

1. Fetch job and analysis.
2. Call draft-outreach endpoint.
3. Store draft in outreach table.
4. Optionally create Gmail draft.
5. Notify user that draft is ready for review.

### 13.4 Workflow D: Follow-Up Reminder

Trigger:

* Daily scheduled trigger

Steps:

1. Query jobs/outreach with follow_up_due <= today.
2. Generate follow-up draft if needed.
3. Create Google Calendar reminder or email notification.
4. Update status to follow_up_due.

### 13.5 Workflow E: Weekly Report

Trigger:

* Sunday evening scheduled trigger

Steps:

1. Query weekly CRM metrics.
2. Call generate-weekly-report endpoint.
3. Save report to database.
4. Save report file to Azure Blob Storage.
5. Email report summary to user.

## 14. Zapier Companion Workflow Plan

Zapier should not be the core system. It should demonstrate that the project can integrate with business-friendly automation tools.

### Suggested Zapier flow

Trigger:

* New row/job added in CRM or Google Sheet

Actions:

1. Create Google Calendar follow-up reminder.
2. Create Gmail draft from outreach text.
3. Send Slack/email notification to self.

Documentation should explain:

* why Zapier is useful for quick business-user workflows;
* how it differs from n8n;
* what part of the system it handles.

## 15. Make.com Companion Scenario Plan

Make.com should be used to demonstrate visual operations automation.

### Suggested Make scenario

Trigger:

* Webhook receives new job record

Actions:

1. Parse payload.
2. Call Azure Function for job scoring.
3. Store result in CRM.
4. Send formatted email notification.

Documentation should include:

* scenario diagram screenshot;
* modules used;
* payload examples;
* comparison against n8n.

## 16. Azure Implementation Plan

### Phase 1 Azure usage

Use Azure for:

* Azure Blob Storage for documents and reports.
* Azure Functions for backend AI endpoints.
* Azure Static Web Apps for dashboard deployment.

### Phase 2 Azure usage

Add:

* Azure Application Insights for monitoring.
* Azure Key Vault for secrets.
* Azure Database for PostgreSQL or Azure SQL.

### Phase 3 Azure usage

Optional advanced additions:

* Azure AI Search for semantic retrieval across resume/project history.
* Azure OpenAI if account access is available.
* Azure Container Apps for self-hosting n8n.

## 17. Security and Safety Notes

### Must-have protections

* Do not commit API keys.
* Use `.env.example` only.
* Store secrets in Azure configuration or local `.env`.
* Never auto-send emails without approval.
* Add clear “draft only” behavior for outreach.
* Avoid scraping platforms in violation of their terms.
* Add rate limits for AI endpoints if public.
* Log AI outputs but avoid exposing secrets or private resume data publicly.

### Human-in-the-loop policy

The system may:

* analyze jobs;
* generate scores;
* draft outreach;
* suggest resume changes;
* generate reports.

The system must not:

* submit job applications automatically;
* send emails automatically;
* claim false experience;
* impersonate the user without review;
* mass-message recruiters without approval.

## 18. Development Roadmap

> **Current status (2026-06-25):** all phases below (0–8) are built and live, and the project has
> since shipped two follow-on initiatives — the production-grade AI program (epics #43 → #51 → #61 →
> #70 → #76) and the **product overhaul** (epic #124: truthful data, JobRight-style jobs feed,
> add-job URL autofill, persistent agent outputs, global assistant widget, Clerk-consolidated
> profile; all six phases #118–#123 merged). The only remaining items are two owner-gated deploy
> follow-ups (#141, #142). See `docs/ROADMAP.md` and `docs/IMPLEMENTATION_STATUS.md` for the live
> status of record.

## Phase 0: Project Foundation

Goal:

Create the repo structure, documentation, environment files, frontend/backend scaffolds, and placeholder APIs.

Deliverables:

* README.md
* docs folder
* frontend scaffold
* backend scaffold
* database schema draft
* .env.example
* project scripts
* basic local dev instructions

## Phase 1: CRM MVP

Goal:

Create the core job tracking system.

Deliverables:

* jobs table
* create job form
* jobs list page
* job detail page
* status updates
* notes field
* priority field

## Phase 2: AI Parsing and Fit Scoring

Goal:

Add LLM-powered job understanding.

Deliverables:

* parse-job endpoint
* score-fit endpoint
* prompt files
* structured JSON validation
* job_analysis table integration
* UI display for fit score and skills

## Phase 3: Outreach Drafting

Goal:

Generate human-approved outreach drafts.

Status:

Implemented in the current codebase. The job detail page can generate outreach drafts, the inbox lists them for human review, reviewers can approve, skip, or mark a draft sent manually, and optional Gmail draft creation is available behind a feature flag. The flow was browser-verified locally after Gmail OAuth setup.

Deliverables:

* outreach table
* draft-outreach endpoint
* outreach UI
* manual approval status workflow
* Gmail draft integration behind a feature flag

## Phase 4: n8n Automation

Goal:

Connect the system through n8n.

Deliverables:

* n8n webhook workflow
* scheduled processing workflow
* email digest workflow
* follow-up reminder workflow
* exported workflow JSON files
* n8n screenshots and README

## Phase 5: Weekly Reporting

Goal:

Add analytics and weekly strategy reports.

Deliverables:

* weekly_reports table
* report generation endpoint
* report dashboard
* scheduled n8n workflow
* email summary
* Blob Storage report upload

## Phase 6: Azure Deployment

Goal:

Deploy the project publicly or semi-publicly.

Deliverables:

* frontend deployed to Azure Static Web Apps
* API deployed to Azure Functions
* Blob Storage configured
* environment variables configured
* deployment docs
* demo screenshots

## Phase 7: Zapier and Make Companion Flows

Goal:

Demonstrate cross-platform automation.

Deliverables:

* one Zapier workflow
* one Make scenario
* docs and screenshots
* comparison section in README

## Phase 8: Advanced Agents

Goal:

Add high-value agent workflows.

Deliverables:

* interview prep agent
* hiring manager research agent
* skill-gap learning planner
* salary/offer prep assistant

## 19. First Codex Task: Foundation Setup

The first Codex task should focus only on the project foundation. Do not ask Codex to implement all AI features immediately.

### Codex goals

1. Create the repo structure.
2. Set up a frontend app.
3. Set up a backend API scaffold.
4. Add shared types if useful.
5. Add docs.
6. Add database schema draft.
7. Add placeholder API routes/functions.
8. Add sample data.
9. Add environment examples.
10. Update README with local development instructions.

### Expected output from Codex

* A working frontend scaffold.
* A working backend scaffold.
* Clear docs.
* No broken scripts.
* No real API keys.
* No overbuilt features.
* Clean commits.

## 20. Codex Implementation Instructions — First Prompt

Use the following prompt for Codex.

````md
You are working on a new project called AI JobOps Copilot.

The goal is to create a cloud-enabled AI automation CRM for job search operations. The project will eventually use React/Next.js, Azure Functions, Azure Blob Storage, a CRM-style database, n8n workflows, Zapier, Make.com, and LLM-powered agents.

For this first task, do NOT build the full system. Your job is to lay a clean, production-quality foundation that later agents can extend.

## Project goals

AI JobOps Copilot should eventually support:

- manual job intake;
- job description parsing;
- resume-fit scoring;
- truthful resume-tailoring suggestions;
- recruiter/referral outreach drafting;
- human approval before sending anything;
- CRM status tracking;
- follow-up reminders;
- weekly analytics reports;
- n8n automation workflows;
- Zapier and Make.com companion workflows;
- Azure cloud deployment.

## Current task scope

Please implement Phase 0: Project Foundation.

Create a clean monorepo-style structure:

```text
ai-jobops-copilot/
  README.md
  .env.example
  .gitignore
  package.json
  docs/
    PROJECT_IMPLEMENTATION_PLAN.md
    ARCHITECTURE.md
    DATABASE_SCHEMA.md
    API_SPEC.md
    AUTOMATION_WORKFLOWS.md
    AZURE_DEPLOYMENT.md
    HUMAN_IN_THE_LOOP_POLICY.md
    ROADMAP.md
    CODEX_NOTES.md
  apps/
    web/
    api/
  db/
    migrations/
    seed/
  workflows/
    n8n/
      README.md
      exports/
    zapier/
      README.md
    make/
      README.md
  prompts/
    job-parser.md
    fit-scorer.md
    resume-tailor.md
    outreach-drafter.md
    weekly-report.md
  samples/
    job-descriptions/
    resumes/
    reports/
  scripts/
````

## Frontend requirements

Create a frontend scaffold in `apps/web`.

Preferred stack:

* Next.js or React with TypeScript
* Tailwind CSS if practical
* clean component structure

For now, create placeholder pages/components for:

1. Dashboard home
2. Jobs list
3. Add job
4. Job detail placeholder
5. Outreach
6. Reports
7. Settings

The UI can be simple, but it should look like a real SaaS/internal ops dashboard, not a random demo.

Add sample mock data for jobs and show it in the jobs list/dashboard.

Do not connect to a real backend yet unless it is easy and clean. It is acceptable to use mock data for Phase 0.

## Backend requirements

Create a backend scaffold in `apps/api`.

Preferred options:

* Azure Functions with TypeScript, if straightforward;
* otherwise a clean Express TypeScript API that can later be adapted to Azure Functions.

Create placeholder endpoints:

* GET /api/health
* GET /api/jobs
* POST /api/jobs
* GET /api/jobs/:id
* PATCH /api/jobs/:id
* POST /api/ai/parse-job
* POST /api/ai/score-fit
* POST /api/ai/draft-outreach
* POST /api/ai/generate-weekly-report

For Phase 0, endpoints can return mock responses, but structure them cleanly and document the intended behavior.

## Data model requirements

Add SQL migration drafts under `db/migrations` for these tables:

* jobs
* job_analysis
* outreach
* resume_versions
* weekly_reports

Use PostgreSQL-compatible SQL unless there is a strong reason not to.

Add seed data under `db/seed` for a few sample jobs.

## Prompt files

Create prompt template files under `prompts/`:

* job-parser.md
* fit-scorer.md
* resume-tailor.md
* outreach-drafter.md
* weekly-report.md

Each prompt file should include:

* purpose;
* input format;
* output format;
* safety/quality rules;
* expected JSON schema where applicable.

Important: include a rule that the system must not fabricate resume experience.

## Docs requirements

Create or populate the docs files:

* ARCHITECTURE.md: explain high-level architecture.
* DATABASE_SCHEMA.md: explain tables and fields.
* API_SPEC.md: explain endpoints and request/response examples.
* AUTOMATION_WORKFLOWS.md: explain planned n8n, Zapier, and Make workflows.
* AZURE_DEPLOYMENT.md: explain planned Azure deployment using Azure Static Web Apps, Azure Functions, Blob Storage, and optional PostgreSQL/Application Insights.
* HUMAN_IN_THE_LOOP_POLICY.md: explain that the system drafts and recommends but does not auto-submit applications or auto-send messages.
* ROADMAP.md: explain phases from foundation to advanced agents.
* CODEX_NOTES.md: include implementation notes, assumptions, and next recommended tasks.

If `docs/PROJECT_IMPLEMENTATION_PLAN.md` already exists, preserve it. If not, create a concise version based on this prompt.

## Root README requirements

Create a strong README.md with:

* project title;
* one-line description;
* longer project overview;
* planned feature list;
* tech stack;
* architecture summary;
* local development instructions;
* project status;
* roadmap;
* safety/human approval note.

## Environment requirements

Create `.env.example` with placeholder variables only:

* DATABASE_URL=
* AZURE_STORAGE_CONNECTION_STRING=
* AZURE_STORAGE_CONTAINER_NAME=
* LLM_PROVIDER=
* OPENAI_API_KEY=
* AZURE_OPENAI_ENDPOINT=
* AZURE_OPENAI_API_KEY=
* GOOGLE_GEMINI_API_KEY=
* GMAIL_CLIENT_ID=
* GMAIL_CLIENT_SECRET=
* N8N_WEBHOOK_SECRET=

Do not include real secrets.

## Code quality requirements

* Use TypeScript where possible.
* Keep naming consistent.
* Avoid overengineering.
* Add comments only where they clarify architecture or future work.
* Make sure install/build/dev scripts are documented.
* Avoid adding huge dependencies unless necessary.
* Keep the first commit focused on project foundation.

## Important constraints

Do NOT implement real scraping yet.
Do NOT implement auto-apply.
Do NOT auto-send emails.
Do NOT store real personal data in the repo.
Do NOT commit API keys.
Do NOT build authentication yet unless needed for framework defaults.
Do NOT overbuild the AI agent layer yet.

## After implementation

At the end, report:

1. What files/folders you created.
2. How to run the frontend locally.
3. How to run the backend locally.
4. Which parts are mock/placeholders.
5. What the next recommended implementation task should be.

````

## 21. Second Codex Task: CRM MVP

After Phase 0 is complete, use this next prompt.

```md
Now implement Phase 1: CRM MVP.

Goal: make the job tracking system functional with real create/list/detail/update flows.

Tasks:

1. Implement persistent job storage using the selected database approach.
2. Wire the frontend jobs list to the backend.
3. Implement the Add Job form.
4. Implement job detail page.
5. Implement status updates.
6. Implement priority and notes updates.
7. Add basic validation.
8. Add useful empty/loading/error states.
9. Update docs and README.

Constraints:

- Do not add AI parsing yet except as a placeholder button.
- Do not implement scraping.
- Do not send emails.
- Keep the UI clean and dashboard-like.

At the end, report what changed, how to test it, and what Phase 2 should do.
````

## 22. Third Codex Task: AI Parsing and Fit Scoring

```md
Now implement Phase 2: AI Parsing and Fit Scoring.

Goal: add LLM-powered job analysis while maintaining structured outputs and safety rules.

Tasks:

1. Implement `/api/ai/parse-job` using the prompt in `prompts/job-parser.md`.
2. Implement `/api/ai/score-fit` using the prompt in `prompts/fit-scorer.md`.
3. Add server-side JSON schema validation for LLM outputs.
4. Save job analysis results into `job_analysis`.
5. Update job `fit_score` after scoring.
6. Display analysis on the job detail page.
7. Add clear error handling if the LLM output is invalid.
8. Add mock mode for development when no API key is configured.
9. Update docs.

Constraints:

- Do not fabricate resume experience.
- Do not implement resume PDF generation yet.
- Do not send outreach yet.
- Keep outputs explainable and auditable.

At the end, report how to test parsing/scoring and what the next task should be.
```

## 23. Fourth Codex Task: Outreach Drafting

```md
Now implement Phase 3: Outreach Drafting.

Goal: generate recruiter/referral/follow-up drafts and store them for human review.

Tasks:

1. Implement `/api/ai/draft-outreach` using `prompts/outreach-drafter.md`.
2. Save drafts into the `outreach` table.
3. Add an Outreach page listing drafts.
4. Add a Generate Outreach button on the job detail page.
5. Add draft statuses: drafted, approved, sent, skipped.
6. Do not send messages automatically.
7. Optionally add Gmail draft integration behind a feature flag.
8. Update human-in-the-loop docs.

Constraints:

- Human approval is required before anything is sent.
- Do not mass-message contacts.
- Do not claim the user applied unless job status confirms it.

At the end, report how to test outreach drafting and what the next task should be.
```

## 24. Fifth Codex Task: n8n Workflow Integration

```md
Now implement Phase 4: n8n Workflow Integration.

Goal: connect the app to n8n through webhooks and documented workflows.

Tasks:

1. Add webhook endpoints for job-created and weekly-report triggers if needed.
2. Create n8n workflow documentation in `workflows/n8n/README.md`.
3. Add example JSON payloads for n8n webhook calls.
4. Add a sample exported workflow JSON if possible.
5. Implement a workflow where new job creation triggers parse + score + notification.
6. Implement a scheduled weekly report workflow if feasible.
7. Add `N8N_WEBHOOK_SECRET` validation for incoming webhook calls.
8. Update docs.

Constraints:

- Do not implement LinkedIn scraping yet.
- Do not auto-send emails.
- Keep workflows auditable.

At the end, report workflow setup steps and any manual configuration needed in n8n.
```

## 25. Final Portfolio Deliverables

The finished project should include:

* GitHub repo with clean README.
* Working dashboard.
* Working API.
* Database schema.
* AI parsing and scoring.
* Outreach drafting.
* Human approval policy.
* n8n workflow export/screenshots.
* Zapier workflow screenshot/doc.
* Make.com scenario screenshot/doc.
* Azure deployment documentation.
* Demo video.
* Architecture diagram.
* Sample weekly report.

## 26. Suggested Demo Script

A strong 3-minute demo should show:

1. Add a job description.
2. AI extracts structured job requirements.
3. AI scores fit against profile/resume.
4. Dashboard updates fit score and status.
5. Generate recruiter outreach draft.
6. Show draft is pending approval, not sent automatically.
7. Change status to applied.
8. Show follow-up reminder generated.
9. Show weekly report with job-search analytics.
10. Show n8n workflow and Azure architecture diagram.

## 27. Success Criteria

The project is successful if a recruiter can quickly understand that you can:

* design useful automation systems;
* connect multiple tools through workflows;
* build cloud-backed applications;
* use AI agents responsibly;
* structure data and APIs cleanly;
* build dashboards and reports;
* think in terms of operations, not only code.
