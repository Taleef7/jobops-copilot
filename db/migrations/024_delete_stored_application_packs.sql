-- Migration 024: delete stored application packs (#343).
-- Packs built before this fix contain invented answers: "Yes" to work
-- authorization, "No" to sponsorship, the posted salary as the user's
-- expectation, and template "why us" / experience claims. They are served back
-- as-is from agent_outputs, so they are deleted; the pack is rebuilt from the
-- user's saved answers the next time it is assembled. Saved answers
-- (application_answers) are not touched.
-- Dry run: select count(*) from agent_outputs where kind = 'application_pack';
DELETE FROM agent_outputs WHERE kind = 'application_pack';
