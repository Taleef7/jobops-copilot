# Roadmap

## Status Summary

- Phase 0: complete
- Phase 1: complete
- Phase 2: complete
- Phase 3: complete
- Phase 4: complete
- Phase 5: in progress
- Phase 6: partial, because Azure PostgreSQL is complete but app hosting is still pending
- Phase 7: planned
- Phase 8: planned

## Phase 0: Project Foundation

Done:

- repo structure
- frontend scaffold
- API scaffold
- SQL drafts
- prompt templates
- docs and sample data

## Phase 1: CRM MVP

Done:

- persistent job CRUD
- jobs list
- job detail
- status updates
- notes and priority editing

## Phase 2: AI Parsing And Fit Scoring

Done:

- parse-job endpoint
- score-fit endpoint
- structured LLM outputs
- job analysis persistence
- analysis actions on the job detail page
- Azure PostgreSQL bootstrap support

## Phase 3: Outreach Drafting

Done:

- draft-outreach endpoint integration into the UI
- outreach review and approval workflow
- persisted outreach drafts
- manual approved, sent, and skipped status controls
- optional Gmail draft support behind a feature flag, browser-verified locally

## Phase 4: n8n Integration

In progress:

- webhook-driven processing
- daily job discovery workflow
- weekly report automation
- follow-up reminders
- sample export JSON files and workflow docs

## Phase 5: Weekly Reporting

In progress:

- report storage
- report dashboards
- Blob Storage report exports
- weekly report API and n8n workflow persistence

## Phase 6: Azure Deployment

Partial:

- Azure PostgreSQL is in place and verified
- full static web app or app hosting still needs to be deployed
- API hosting still needs to be deployed
- Blob Storage, monitoring, and secrets management still need to be wired in

## Phase 7: Zapier And Make

Planned:

- one Zapier flow
- one Make scenario
- screenshots and comparison notes

## Phase 8: Advanced Agents

Planned:

- interview prep
- hiring manager research
- skill gap planning
- salary or offer prep support
