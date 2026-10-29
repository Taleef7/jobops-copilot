-- Migration 031: cover letters get their own table (#416).
--
-- One letter per job and user, written in the tailor window and checked against the base
-- résumé. It lived as an `outreach` row of message_type 'cover_letter' before, which the
-- outreach_message_type_check refused, and which the next outreach draft for the job deleted
-- (appendOutreachDraft replaces the job's unsent drafts). A table of its own keeps it apart
-- from both, with an owner on every row from the start (docs/SPEC.md, data model).
--
-- paragraphs: [{ text, edited }], the letter's body as it stands.
-- checks:     the sentences the check dropped or marked, with why.
-- based_on:   the base résumé version, a hash of the posting, the model, the confirmed keywords.

-- A letter's owner is its job's owner: the foreign key is on (job_id, user_id), which needs a
-- unique index on jobs (id, user_id). It is unique already (id is the primary key); the index
-- only lets the key reference it.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_id_user_id_key ON jobs (id, user_id);

CREATE TABLE IF NOT EXISTS cover_letters (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  job_id uuid NOT NULL,
  length text NOT NULL CONSTRAINT cover_letters_length_check CHECK (length IN ('concise', 'full')),
  paragraphs jsonb NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  based_on jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cover_letters_user_job_key UNIQUE (user_id, job_id),
  CONSTRAINT cover_letters_job_owner_fkey FOREIGN KEY (job_id, user_id) REFERENCES jobs (id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cover_letters_job_id_idx ON cover_letters (job_id);
