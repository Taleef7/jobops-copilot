# Database Schema

All tables are drafted in PostgreSQL-compatible SQL under `db/migrations`.

## `jobs`

Primary CRM table for every opportunity.

Important fields:

- `id`: UUID primary key
- `job_url`: optional unique URL
- `source`: discovery source
- `company`: company name
- `title`: role title
- `location`: role location
- `employment_type`: full-time, contract, etc.
- `workplace_type`: remote, hybrid, onsite, or flexible
- `date_posted`: optional posted date
- `discovered_at`: when the job entered the CRM
- `description_text`: raw job description
- `status`: pipeline state
- `priority`: high, medium, or low
- `fit_score`: optional numeric score
- `notes`: internal notes
- `next_action`: next manual or automated step
- `next_action_due`: optional follow-up timestamp
- `created_at` / `updated_at`: timestamps

## `job_analysis`

Stores AI-generated understanding of a job.

Important fields:

- `job_id`: foreign key to `jobs.id`
- `required_skills`
- `preferred_skills`
- `matched_skills`
- `missing_skills`
- `ats_keywords`
- `fit_summary`
- `recommended_resume_angle`
- `apply_recommendation`
- `confidence_score`
- `model_used`
- `created_at`

## `outreach`

Stores draft outreach and follow-up messages.

Important fields:

- `job_id`: foreign key to `jobs.id`
- `contact_name`
- `contact_role`
- `contact_source`
- `linkedin_url`
- `email`
- `message_type`
- `draft_text`
- `status`
- `gmail_draft_id`
- `created_at`
- `sent_at`
- `follow_up_due`

## `resume_versions`

Tracks tailored resume versions and review state.

Important fields:

- `job_id`: foreign key to `jobs.id`
- `base_resume_file_url`
- `tailored_resume_file_url`
- `change_summary`
- `approved`
- `created_at`

## `weekly_reports`

Stores weekly analytics and strategy outputs.

Important fields:

- `week_start`
- `week_end`
- `jobs_discovered`
- `jobs_shortlisted`
- `jobs_applied`
- `outreach_drafted`
- `outreach_sent`
- `responses_received`
- `interviews`
- `common_missing_skills`
- `recommendations`
- `report_url`
- `created_at`
