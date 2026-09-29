-- Migration 023: revoke every Chrome extension token (#342).
-- The extension is paused and /api/ext answers 410. Revoking the tokens means a
-- restored extension API can't accept a token issued before the pause.
-- The ext_tokens table and saved answers (application_answers) are kept.
-- Dry run: select count(*) from ext_tokens where revoked_at is null;
UPDATE ext_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
