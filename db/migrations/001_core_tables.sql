create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists jobs (
  id uuid primary key,
  job_url text unique,
  source text not null,
  company text not null,
  title text not null,
  location text,
  employment_type text,
  workplace_type text,
  date_posted timestamptz,
  discovered_at timestamptz not null default now(),
  description_text text not null,
  status text not null default 'discovered',
  priority text not null default 'medium',
  fit_score integer,
  notes text,
  next_action text,
  next_action_due timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_status_check check (
    status in (
      'discovered',
      'shortlisted',
      'applied',
      'outreach_drafted',
      'outreach_sent',
      'referral_requested',
      'follow_up_due',
      'interview',
      'rejected',
      'offer',
      'archived'
    )
  ),
  constraint jobs_priority_check check (priority in ('high', 'medium', 'low')),
  constraint jobs_fit_score_check check (fit_score is null or (fit_score between 0 and 100))
);

create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_priority_idx on jobs (priority);
create index if not exists jobs_company_idx on jobs (company);

drop trigger if exists jobs_set_updated_at on jobs;

create trigger jobs_set_updated_at
before update on jobs
for each row
execute function set_updated_at();

create table if not exists job_analysis (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  required_skills jsonb not null default '[]'::jsonb,
  preferred_skills jsonb not null default '[]'::jsonb,
  matched_skills jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,
  ats_keywords jsonb not null default '[]'::jsonb,
  fit_summary text not null,
  recommended_resume_angle text not null,
  apply_recommendation text not null,
  confidence_score integer,
  model_used text not null,
  created_at timestamptz not null default now(),
  constraint job_analysis_confidence_check check (confidence_score is null or (confidence_score between 0 and 100))
);

create index if not exists job_analysis_job_id_idx on job_analysis (job_id);
create unique index if not exists job_analysis_job_id_unique_idx on job_analysis (job_id);

create table if not exists outreach (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  contact_name text,
  contact_role text,
  contact_source text,
  linkedin_url text,
  email text,
  message_type text not null,
  draft_text text not null,
  status text not null default 'drafted',
  gmail_draft_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  follow_up_due timestamptz,
  constraint outreach_status_check check (status in ('drafted', 'approved', 'sent', 'skipped')),
  constraint outreach_message_type_check check (
    message_type in (
      'recruiter_email',
      'linkedin_connection',
      'referral_request',
      'follow_up',
      'thank_you'
    )
  )
);

create index if not exists outreach_job_id_idx on outreach (job_id);
create index if not exists outreach_status_idx on outreach (status);

create table if not exists resume_versions (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  base_resume_file_url text not null,
  tailored_resume_file_url text,
  change_summary text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists resume_versions_job_id_idx on resume_versions (job_id);

create table if not exists weekly_reports (
  id uuid primary key,
  week_start date not null,
  week_end date not null,
  jobs_discovered integer not null default 0,
  jobs_shortlisted integer not null default 0,
  jobs_applied integer not null default 0,
  outreach_drafted integer not null default 0,
  outreach_sent integer not null default 0,
  responses_received integer not null default 0,
  interviews integer not null default 0,
  common_missing_skills jsonb not null default '[]'::jsonb,
  recommendations text not null,
  report_url text,
  created_at timestamptz not null default now()
);
