# Web e2e (Playwright) — Phase 5 · U

Smoke tests for the web app's **public surface** — the routes `src/proxy.ts`
(`isPublicRoute`) allows without auth: `/`, `/architecture`, `/sign-in`, `/sign-up`.
They assert each loads (status < 400, body visible, non-empty `<title>`, no uncaught
page errors) and that a protected route (`/dashboard`) redirects an unauthenticated
visitor to sign-in — exercising the Clerk middleware end to end.

## Prerequisites

The Next.js app needs Clerk keys to boot (`ClerkProvider` + `clerkMiddleware`):

- Locally: `apps/web/.env.local` already provides `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  and `CLERK_SECRET_KEY`.
- CI: set those as repo **secrets**; the `e2e` job skips (and stays green) when they're absent.

## Run

```bash
cd apps/web
npm run e2e:install     # one-time: download the Chromium browser
npm run test:e2e        # starts `next dev` and runs the suite

# Against an already-running / deployed target (skips the dev server):
E2E_BASE_URL=https://jobops-web.azurewebsites.net npm run test:e2e
```

Authenticated flows (the `(app)` routes behind sign-in) are **not** covered here — they
need a Clerk test user / testing token. This suite deliberately stays on the public
surface so it runs without seeded credentials.
