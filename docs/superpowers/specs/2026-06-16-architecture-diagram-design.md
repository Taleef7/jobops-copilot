# Design — Architecture diagram + interactive /architecture page

**Date:** 2026-06-16
**Status:** Approved (user picked blueprint style "C"; delegated authority to proceed autonomously)

## Goal

Close the two remaining "Final Portfolio Deliverables" that involve a system
diagram, and tighten repo presentation:

1. A polished **static hero architecture diagram** (always-visible, GitHub- and
   offline-renderable).
2. A **modern, interactive** version on the already-deployed Next.js app.
3. Repo presentation: README **badges**, GitHub **description + topics**, and
   reconciliation of one stale doc line.
4. **Verify + polish** the live Azure stack (read-only).

(The user records the demo video themselves; out of scope here.)

## Chosen visual direction

**Engineering blueprint** — navy background with a faint grid, monospace
(Geist Mono, already loaded) labels, dashed signal traces, cyan/teal accents.
Picked from a 3-way browser mockup (A clean-SaaS, B dark-glow, C blueprint).
The blueprint look carries its own dark background, so a **single SVG** renders
correctly on both light and dark GitHub themes (no `<picture>` dual-asset needed).

## Architecture of the work

Two independent PRs (lower risk; the zero-risk docs PR lands even if the page
needs iteration). I open PRs; the user merges (never me).

### PR1 — docs: blueprint diagram + badges + metadata + reconciliation

- `docs/architecture/architecture-blueprint.svg` — hand-authored hero SVG, full
  topology: Web (Next.js 16 + Clerk) → API (Express) → Agent (FastAPI +
  LangChain) → Azure Postgres + pgvector; plus Blob Storage, LLM providers ×4
  (Anthropic / Azure OpenAI / OpenAI / Gemini), HF embeddings (PyTorch), pandas
  telemetry, automation (n8n / Make / Zapier), App Insights, Key Vault. Labeled
  data-flow edges (REST, delegate AI, RAG, embed, webhook, secrets, traces).
- `README.md` — badge row (CI status, license, Next.js, React, TypeScript,
  Python, FastAPI, Azure, LangChain, pgvector, live demo, human-in-the-loop);
  embed hero SVG near the top; reconcile the stale blockquote that says the agent
  "runs locally for the full-AI demo" (it is deployed on Container Apps and
  warmable via `scripts/azure/demo.sh warm`).
- `docs/ARCHITECTURE.md` — embed the hero SVG; add two **Mermaid** sub-diagrams
  (job-intake data flow; request lifecycle) for maintainable, GitHub-native
  rendering.
- `.gitignore` — ignore `.superpowers/` (brainstorm companion artifacts).

### GitHub repo metadata (direct, not via PR)

`gh repo edit Taleef7/jobops-copilot` — set a crisp About **description** and add
~18 **topics**: ai-agents, llm, rag, pgvector, langchain, nextjs, typescript,
python, fastapi, azure, job-search, automation, n8n, human-in-the-loop,
vector-search, react, tailwindcss, crm. Low-risk, explicitly requested, easily
reversible; report exactly what was set.

### PR2 — feat(web): interactive /architecture page (React Flow)

- Add `@xyflow/react` (React Flow v12; verify React 19 / Next 16 compatibility
  via context7 + a clean `npm run check` build before relying on it).
- Route `apps/web/src/app/(marketing)/architecture/page.tsx` (inherits the public
  marketing header/footer; URL `/architecture`). Server component renders a
  `'use client'` `ArchitectureFlow` (React Flow is browser-only). Explicit
  container height to avoid SSR measure issues.
- Blueprint theme to match the SVG: custom node component, dashed animated edges,
  navy grid `<Background>`, pan/zoom controls; nodes clickable → deep-link to the
  relevant doc/live endpoint.
- `apps/web/src/proxy.ts` — add `'/architecture(.*)'` to the public route matcher
  so it is reachable without sign-in.
- Marketing header — add an "Architecture" nav link.
- `README.md` — add a "View the live interactive diagram → /architecture" link.

## Constraints / risks considered

- **CI is required on protected `main`** → PR2 must pass `npm run check` (lint,
  typecheck, build) in `apps/web`. Mitigation: pin a React-19-compatible
  `@xyflow/react`, verify via context7, build locally before pushing.
- **GitHub README cannot run JS** → interactivity must live on the hosted app,
  not in the README. Hence static SVG in README + interactive page on the live
  site. (This is the core reason for the two-layer approach.)
- **Public access** → `/architecture` must be in the Clerk public matcher; it is
  a portfolio artifact, not gated.
- **Cost** → live-stack verification uses only the read-only `demo.sh status`; no
  `warm` (which would bill ~$20–30/mo) unless the user asks.
- **PR hygiene** → branch from `main`, focused commits, open PR, user merges.

## Success criteria

- Hero SVG renders correctly on github.com in both themes and embedded in README.
- `/architecture` builds clean, loads publicly, pans/zooms, nodes link out, looks
  consistent in light/dark.
- `npm run check` green; no new console errors.
- Repo shows description + topics + badges.
- Live-stack status reported (no cost incurred).

## Out of scope (future / beyond plan)

Demo video (user-owned), job-board ingestion, and any net-new feature work.
