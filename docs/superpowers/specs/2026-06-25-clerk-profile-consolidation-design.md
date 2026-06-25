# Phase 6 — Consolidate profile management on Clerk (design)

**Date:** 2026-06-25
**Epic:** #124 · **Phase issue:** #123 (final overhaul phase)
**Status:** Approved (brainstorm), pending implementation plan

## Goal

One source of truth for identity. Clerk owns name / avatar / email / connected
accounts / security (already surfaced via `<UserButton>` in the header). The app
keeps only what's app-specific — the **resume** (for fit scoring / outreach) and
the grounding **`profileText`**. Remove the duplicate app-side identity field
(`displayName`) and stop presenting it.

## Root cause (verified)

- The app stores its own `display_name` in `user_profiles`
  (`apps/api/src/data/profile-store.ts`) and the Settings "Profile & resume" card
  renders an avatar initial + name from it (`apps/web/src/app/(app)/settings/page.tsx:49,85`).
- Clerk already provides name / email / avatar / connected accounts / security via
  `<UserButton>` (`apps/web/src/components/app-header.tsx`). Result: name + avatar
  are presented in two places.
- **`displayName` is vestigial:** no UI writes it — `updateProfile` (the only client
  that sends it) has **zero callers**, and `saveResumeText` / `uploadResumeFile`
  never send `display_name`. It is only *read* in the Settings card.
- **`profileText` is NOT identity** — it is grounding text used by fit scoring
  (`analysis-core.ts`, `ai.ts:95`) and outreach (`ai.ts:179`), set via the n8n
  intake route. It stays.

## Locked decisions (from brainstorm)

1. **Settings card** shows the real Clerk **identity (read-only)** — avatar + name
   from `currentUser()` — alongside resume management, plus a pointer:
   "Manage your name, email & avatar from the account menu (top-right)." No
   duplicate *editing*; the displayed identity is sourced from Clerk (the single
   source), not the app.
2. **Remove `displayName`** entirely: a migration drops the column and it is
   stripped from the store, profile routes, API types, and web client.
3. **One PR** off `main` — frontend + backend cleanup + migration are coupled by
   the `displayName` type removal and the change is small.

## Architecture

### Identity source (Settings, server component)

`settings/page.tsx` is already an async Server Component. Use
`currentUser()` from `@clerk/nextjs/server` for `fullName` / `firstName` /
`imageUrl`. No client island, no loading flicker. Fetch it in parallel with the
existing `fetchProfile()` (resume presence) and `fetchStatus()`.

### Components touched

| File | Change |
|------|--------|
| `db/migrations/009_drop_display_name.sql` | `alter table user_profiles drop column if exists display_name;` |
| `apps/api/src/data/profile-store.ts` | Drop `displayName` from `UserProfile`, `display_name` from `ProfileRow`, `mapRow`, and the upsert column list / params. |
| `apps/api/src/routes/profile.ts` | Drop `displayName` from `publicProfile`, the `PUT /` body type + param, and the `POST /resume` `display_name` body field. Keep `profileText`. |
| `apps/web/src/lib/api.ts` | Drop `displayName` from `UserProfile` and from the `updateProfile` payload type. |
| `apps/web/src/app/(app)/settings/page.tsx` | Replace the `displayName` avatar/name with Clerk `currentUser()` avatar + name (read-only); keep the resume row + `ResumeReupload`; add the account-menu pointer line. |

### Settings "Profile" card (after)

- Avatar: Clerk `imageUrl` (Next `<Image>` / `<img>`); fallback to the initial of
  `fullName` (else "You") when no image.
- Name: Clerk `fullName` (fallback "Your profile").
- Resume row: unchanged — `resumeFileName` / "No resume uploaded yet" + `ResumeReupload`.
- Helper line: "Manage your name, email & avatar from the account menu (top-right)."
- Card description shifts to resume framing: "Resume grounds fit scoring & outreach."

## Data flow

```
Settings (server) → Promise.all[ currentUser() (Clerk identity),
                                 fetchProfile() (resume presence),
                                 fetchStatus() ]
  → render Clerk avatar + name (read-only) + resume management + account-menu pointer
No displayName is read, returned, or stored anywhere.
```

## Error handling

- `currentUser()` → null only when unauthenticated; the `(app)` group is auth-gated,
  so fall back to "You" / "Your profile" defensively.
- `fetchProfile()` / `fetchStatus()` already degrade to `null` on failure (unchanged).
- Migration uses `drop column if exists` → idempotent and safe to re-run via `db-init`.

## Testing

- **API:** a `profile.ts` route test asserting `publicProfile` no longer exposes
  `displayName` and still exposes `profileText` / `hasResume` / `resumeFileName`.
  Confirm the store upsert + resume route still work without `display_name`
  (existing profile tests must stay green). No existing test references the profile
  `displayName` (the only `display_name` test refs are unrelated Adzuna fields).
- **Web:** the Settings Server Component using `currentUser()` is not cheaply
  unit-testable; it is presentational and covered by `tsc` + the existing
  `settings-actions` tests. Verify the full web suite + `tsc` + `eslint` stay green.
- **Backend gates:** full API (`node:test`) + Python (`pytest`) suites + `ruff`.

## Build slice — 1 PR off `main`

| PR | Scope |
|----|-------|
| **A** | migration `009` + strip `displayName` from store/routes/web client + Settings card on Clerk identity + tests |

## YAGNI (out of scope)

No editing Clerk fields from inside the app; no Clerk→app sync; no changes to
`profileText` / resume storage; no removing the dead `updateProfile` / `PUT /api/profile`
endpoint beyond dropping its `displayName` param.

## Workflow

One branch off `main`; one PR; address Codex review; **owner merges**. Verify per
`docs/TESTING.md`.
