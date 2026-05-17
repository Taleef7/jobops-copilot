# Automation Workflows

## n8n

n8n is the primary orchestrator in the long-term design.

Planned workflows:

- manual job intake processing
- daily job discovery
- outreach drafting
- follow-up reminders
- weekly reporting

## Zapier

Zapier is the lightweight companion automation layer.

Planned use:

- create calendar reminders
- create Gmail drafts
- send a self-notification after a job is added

## Make.com

Make.com demonstrates a visual automation scenario.

Planned use:

- receive a new job payload via webhook
- call the API for scoring
- store or update the CRM record
- send a formatted summary message

## Shared Automation Rules

- Never auto-send outreach without approval.
- Keep every action auditable in the CRM.
- Treat automations as workflow infrastructure, not spam tooling.
