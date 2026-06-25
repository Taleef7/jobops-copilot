-- Phase 6 — consolidate identity on Clerk. The app no longer stores or presents
-- its own name; Clerk owns name/avatar/email. `profile_text` (grounding) and the
-- resume columns stay. Idempotent so db-init can re-run it safely.
alter table user_profiles drop column if exists display_name;
