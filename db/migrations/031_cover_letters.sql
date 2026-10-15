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

CREATE TABLE IF NOT EXISTS cover_letters (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  length text NOT NULL CONSTRAINT cover_letters_length_check CHECK (length IN ('concise', 'full')),
  paragraphs jsonb NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  based_on jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cover_letters_user_job_key UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS cover_letters_job_id_idx ON cover_letters (job_id);
