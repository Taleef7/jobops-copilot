# n8n Workflows

This folder documents the primary automation orchestrator.

## Planned Workflows

### Manual Job Intake Processing

- Triggered when a new job is created in the dashboard.
- Fetches the job record.
- Calls the parse-job and score-fit endpoints.
- Updates the CRM with analysis and follow-up metadata.

### Daily Job Discovery

- Scheduled run.
- Pulls candidate jobs from configured sources.
- Deduplicates on job URL.
- Creates CRM records.
- Triggers analysis and digest notifications.

### Outreach Drafting

- Triggered when a job is shortlisted or when the user requests outreach.
- Generates a draft.
- Stores it in the outreach table.
- Optionally creates a Gmail draft later.

### Follow-Up Reminder

- Scheduled daily run.
- Finds overdue follow-ups.
- Creates a reminder or calendar event.

### Weekly Report

- Scheduled weekly run.
- Builds the weekly report.
- Saves it to storage and emails the summary.

## Exports

Exported workflow JSON files will live in `exports/` once the first real flows are built.
