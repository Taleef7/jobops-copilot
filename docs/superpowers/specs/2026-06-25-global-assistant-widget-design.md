# Phase 5 — Global floating assistant + quick prompts (design)

**Date:** 2026-06-25
**Epic:** #124 · **Phase issue:** #122 (also closes #113 · J5 — assistant a11y)
**Status:** Approved (brainstorm), pending implementation plan

## Goal

A floating bottom-right chat widget available on **every** app page — multi-turn,
context-aware, token-streamed — with context-aware quick-prompt buttons. The
existing structured-run `/assistant` page stays as-is (deep, human-in-the-loop
pipeline); the widget is the quick conversational layer.

## Locked decisions (from brainstorm)

1. **Multi-turn** — the widget remembers prior messages in the session; history
   is sent to the LLM each turn (within the existing daily-budget guard).
2. **Context-aware** — on a job detail page the widget knows that job
   (title/company/description + the user's fit analysis); elsewhere it's general.
3. **Persistence** — survives reload + full navigation, **not** logout. Implemented
   client-side via `sessionStorage` keyed by the Clerk user id (no DB table). See
   the persistence note below for the same-user/same-tab nuance.
4. **Quick prompts** — a context-aware set that adapts to the current page.
5. **Approach A** — a new streamed conversational endpoint in the Python service
   (reusing the LLM provider + safety), piped through Express with the same SSE
   plumbing as the structured run. (Rejected: Node-only chat — would duplicate the
   LLM/safety stack; non-streaming — fails the "streams an immediate answer" bar.)

## Current state (verified)

- Only `/assistant` exists (`apps/web/src/components/assistant-panel.tsx`), backed by
  the structured LangGraph run (`/api/ai/assistant/stream` → Python `/assistant/stream`).
  **No conversational chat endpoint, no global widget.**
- LLM is a LangChain chat model (`services/agent/app/llm/provider.py`, `get_model()`
  returns `(chat, label)`) — supports `.astream()` for token streaming.
- Safety: `app/safety/injection.py` (`scan_for_injection`, `injection_refused`,
  `wrap_untrusted`). Prompts live in `app/prompts.py`.
- Express SSE pattern: `apps/api/src/routes/assistant.ts` pipes the upstream
  `text/event-stream` unbuffered; mounted at the **exact** path before the AI router
  with `strictLimiter` + `enforceDailyBudget` (`apps/api/src/app.ts:86`).
- Web streaming pattern: `apps/web/src/app/api/assistant-stream/route.ts` (dedicated
  Next route; the catch-all `/api/proxy` buffers and can't stream). SSE frame parsing
  lives in `assistant-panel.tsx` (`handleFrame`).
- App shell where the widget mounts: `apps/web/src/app/(app)/layout.tsx`.

## Architecture

### 1. Python — `POST /assistant/chat` (new, streaming)

```
ChatRequest { messages: [{role: 'user'|'assistant', content: str}], context?: str, user_id?: str }
→ StreamingResponse(text/event-stream)
```

- `_require_llm()` guard (503 when no provider — surfaced upstream as "unavailable").
- Build LangChain message list: `SystemMessage(CHAT_ASSISTANT_SYSTEM + optional
  context block)` + prior turns mapped to `HumanMessage`/`AIMessage`. The context
  block (job details, untrusted) is delimited with `wrap_untrusted(context, "JOB CONTEXT")`.
- Safety: `scan_for_injection` over the latest user message + context; if
  `injection_refused(verdict)`, stream a single safe refusal as a `token` then `done`
  (don't call the model).
- Stream: `async for chunk in model.astream(messages): yield _sse("token", {"text": chunk.content})`;
  then `yield _sse("done", {"model_used": label})`. On exception → `yield _sse("error", {"message": ...})`
  (mirrors `_assistant_event_stream`).
- New prompt `CHAT_ASSISTANT_SYSTEM` in `prompts.py`: a concise, honest job-search
  assistant; uses provided context when present; no fabrication; read-only (points
  users to the structured run / actions for anything that sends/changes data).

### 2. Express — `POST /api/ai/assistant/chat` (SSE passthrough + context build)

- `apps/api/src/lib/agent-client.ts`: `streamAssistantChatUpstream(payload)` —
  mirrors `streamAssistantUpstream`, POSTs to `${AGENT_URL}/assistant/chat`.
- `apps/api/src/routes/assistant-chat.ts`: `createAssistantChatRouter({ openUpstream, getJob })`
  (injectable for tests). Flow:
  1. `requireUser`; `400` when `messages` is empty/missing.
  2. **Context (authoritative, ownership-checked):** if body has `jobId`, load
     `getJobById(userId, jobId)`; build a compact context string (title, company,
     location, description excerpt, + analysis fitSummary/matched/missing skills).
     Never throw — a context failure just omits context.
  3. `openUpstream({ messages, context, user_id: userId })`; pipe the SSE through
     unbuffered (same loop as `assistant.ts`); `502/503` when upstream not ok.
- Mount at the exact path **before** the AI router (so guards aren't double-applied),
  with `strictLimiter` + `enforceDailyBudget`:
  `app.use('/api/ai/assistant/chat', strictLimiter, enforceDailyBudget, assistantChatRouter)`
  (placed just above the `/api/ai/assistant/stream` line).

### 3. Web — streaming route + client

- `apps/web/src/app/api/assistant-chat/route.ts`: clone of `assistant-stream/route.ts`,
  forwarding to `${API_BASE}/api/ai/assistant/chat` with the Clerk token + shared
  secret, returning `upstream.body` unbuffered.
- `apps/web/src/lib/assistant-chat.ts`: `streamAssistantChat({ messages, jobId, signal,
  onToken, onDone, onError })` — POSTs to `/api/assistant-chat`, reads the SSE stream,
  parses frames (extracted shared helper), invokes callbacks. Surfaces non-OK status
  (e.g. 429 budget, 503 unavailable) via `onError` with the upstream message.

### 4. Web — the floating widget

`apps/web/src/components/assistant-widget.tsx` (`'use client'`), mounted once in
`(app)/layout.tsx` so it appears on every authed page.

- **Launcher:** fixed bottom-right circular button (`Sparkles`); toggles a chat panel.
- **Panel:** message list (user/assistant bubbles), streaming assistant bubble that
  appends tokens, an input + send, and the quick-prompt row when the thread is empty.
- **Context:** `usePathname()` → derive `jobId` from `/jobs/<id>` (excluding
  `/jobs/new`); passed to `streamAssistantChat`.
- **Quick prompts (context-aware):**
  - Job page: "What am I missing for this role?", "Improve my resume for this job",
    "Draft outreach for this job".
  - Elsewhere: "What should I focus on next?", "Summarize my pipeline", "How do I
    improve my fit scores?".
  - Clicking one sets it as the user message and sends immediately.
- **Persistence:** `sessionStorage` key `jobops:assistant-chat` storing
  `{ userId, messages }`. Hydrate on mount only when `stored.userId === currentUserId`
  (Clerk `useAuth`); write on every messages change. sessionStorage is tab-scoped
  (cleared on tab close) and survives reload + SPA/full navigation. The userId guard
  prevents another user's history showing after a logout→login as a *different* user.
  (Nuance: same user, same tab, logout→login still sees prior history — acceptable;
  no fragile sign-out hook.)
- **a11y (also closes #113 · J5):** focus moves into the panel on open and returns to
  the launcher on close; `Esc` closes; the streaming region is `aria-live="polite"`;
  the launcher has an `aria-label`; respect `prefers-reduced-motion` for open/scroll
  animation.

## Data flow

```
Type / click quick prompt
  → streamAssistantChat({messages, jobId})  (web client)
  → POST /api/assistant-chat                (Next streaming route, attaches auth)
  → POST /api/ai/assistant/chat             (Express: build job context, SSE passthrough)
  → POST /assistant/chat                    (Python: system+context+history → model.astream)
  ← token, token, …, done                   (SSE, piped unbuffered the whole way back)
Panel appends tokens live; on done, the assistant turn is committed + persisted.
```

## Error handling

- No LLM provider → upstream `503`; widget shows "The assistant isn't available right now."
- Budget exceeded → `429` from `enforceDailyBudget`; widget shows the budget message.
- Stream `error` event or network drop mid-stream → error bubble; any partial tokens kept.
- Injection-refused input → assistant returns a safe refusal (model not called).
- Empty `messages` → `400` (defensive; the widget never sends empty).

## Testing

- **Python (`tests/test_assistant_chat.py`):** streams tokens for a normal message
  (monkeypatch `get_model` → fake with `astream`); injection-flagged input returns a
  refusal without calling the model; no-LLM path guarded.
- **Express (`routes/assistant-chat.test.ts`):** pipes upstream bytes through; `400`
  on empty messages; builds context from `jobId` via injected `getJob`; `401`
  unauthenticated; upstream-not-ok → `502/503`.
- **Web (`components/assistant-widget.test.tsx`):** renders the launcher; opens the
  panel; quick prompts reflect the route (job vs general); sending renders streamed
  tokens (mock `streamAssistantChat`); hydrates from / writes to `sessionStorage`;
  ignores another user's stored thread.

## Build slices — 2 PRs off `main`

| PR | Scope | Layer |
|----|-------|-------|
| **A** | Python `/assistant/chat` + `CHAT_ASSISTANT_SYSTEM` + `ChatRequest` + `streamAssistantChatUpstream` + Express `assistant-chat` router (context build) + mount + tests | backend (TDD) |
| **B** | Next streaming route + web stream client + `assistant-widget` (floating, multi-turn, context-aware quick prompts, sessionStorage, a11y) + mount in app layout + tests | frontend |

## YAGNI (out of scope)

No DB persistence / conversation list, no cross-device sync, no file uploads or voice,
no tool-calling/actions inside chat (read-only Q&A — the structured run owns actions),
no streaming-resume after navigation (a mid-flight stream that's navigated away from is
dropped, not resumed).

## Workflow

Branch each slice off `main`; one PR per slice; address Codex review before
proceeding; **owner merges**. Verify per `docs/TESTING.md`.
