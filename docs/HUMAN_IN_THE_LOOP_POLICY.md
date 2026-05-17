# Human In The Loop Policy

JobOps Copilot is designed to assist, not impersonate or automate the user without review.

## Allowed

- draft outreach messages
- score job fit
- suggest truthful resume tailoring
- generate weekly reports
- create reminders and summaries
- store draft-only automation outputs for review

## Not Allowed

- auto-sending messages
- auto-submitting job applications
- fabricating experience
- pretending a message was reviewed when it was not
- mass messaging contacts without explicit approval
- marking an outreach draft as sent without a human decision

## Current Enforcement In Code

- `parse-job` saves structured analysis back to the CRM when a `job_id` is supplied, but it does not send anything outward.
- `score-fit` updates the stored analysis and `fit_score`, but the user still decides whether a job is worth pursuing.
- `draft-outreach` returns a draft plus safety notes and stores the draft as `drafted` when a valid job ID is supplied.
- `generate-weekly-report` returns a draft report and does not publish it anywhere.
- The UI exposes these actions as explicit buttons so the user stays in control.

## Safety Standard

The system should always make it clear when an output is:

- a draft
- a recommendation
- a placeholder
- or a final human-approved action

## Practical Rule

If an action changes the outside world, it needs a human approval step first.
