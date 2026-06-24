# Jobs Feed — PR B (discovery in Jobs + onboarding step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Put job discovery where users look for jobs (the Jobs tab) and capture target roles/location during onboarding so a new user lands on a populated feed.

**Architecture:** The `SavedSearchesManager` client component (add/list/delete saved searches + "Discover now") already exists and is rendered in Settings. PR B relocates it into the Jobs page and removes the Settings copy, then turns the single-step onboarding into a two-step wizard whose second step captures target criteria, creates the first saved search, runs an initial discovery, and routes to `/jobs`.

**Tech Stack:** Next.js App Router (server + client components), React, Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-06-24-jobs-feed-design.md` (tasks 2.1, 2.2).

**Branch:** `feat/jobs-feed-pr-b` (already created).

**Scope:** PR B of 4. Out of scope: recency filters + cards (PR C), cron (PR D).

---

## Existing API helpers (web, `@/lib/api`) — reuse, do not change
- `createSavedSearch({ query, location?, remoteOnly? }): Promise<SavedSearchItem>`
- `runDiscovery(): Promise<{ inserted; skipped; source }>`
- `fetchSavedSearches()`, `deleteSavedSearch(id)` (used inside `SavedSearchesManager`)
- `saveResumeText(text)`, `uploadResumeFile(file)` (onboarding step 1, existing)

---

## Task 1: Onboarding step 2 — capture target roles/location

**Files:**
- Modify: `apps/web/src/app/onboarding/page.tsx`
- Test: `apps/web/src/app/onboarding/onboarding-page.test.tsx`

The page becomes a two-step wizard via a `step` state (`1 | 2`). Step 1 keeps the resume UI but its button advances to step 2 instead of routing to the dashboard. Step 2 captures a role/keywords query (required), location (optional), and a remote-only toggle, then creates a saved search, runs discovery, and routes to `/jobs`. A "Skip for now" link routes to `/dashboard`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/app/onboarding/onboarding-page.test.tsx` with:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const { saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery } = vi.hoisted(() => ({
  saveResumeText: vi.fn(() => Promise.resolve(null)),
  uploadResumeFile: vi.fn(() => Promise.resolve(null)),
  createSavedSearch: vi.fn(() => Promise.resolve({ id: 's1' })),
  runDiscovery: vi.fn(() => Promise.resolve({ inserted: 3, skipped: 0, source: 'adzuna' })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/api', () => ({ saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery }));

import OnboardingPage from './page';

afterEach(() => {
  vi.clearAllMocks();
});

it('shows an inline alert (in addition to the toast) when continuing with no resume', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: /continue/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/add your resume to continue/i);
});

it('advances to the target-roles step after a resume is saved, then discovers and routes to jobs', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  // Step 1: paste a resume and continue.
  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Senior TypeScript engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  // Step 2 appears: enter target role + discover.
  const roleInput = await screen.findByLabelText(/role or keywords/i);
  await user.type(roleInput, 'AI Engineer');
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  await waitFor(() => expect(createSavedSearch).toHaveBeenCalledWith({
    query: 'AI Engineer',
    location: undefined,
    remoteOnly: false,
  }));
  expect(runDiscovery).toHaveBeenCalledOnce();
  await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs'));
});

it('requires a role/keyword before discovering on step 2', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  await screen.findByLabelText(/role or keywords/i);
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/add at least one role or keyword/i);
  expect(createSavedSearch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/app/onboarding/onboarding-page.test.tsx`
Expected: FAIL — there is no step 2, no "Find matching jobs" button, and the button currently reads "Continue to dashboard".

- [ ] **Step 3: Implement the two-step wizard**

Rewrite `apps/web/src/app/onboarding/page.tsx`. Keep all existing step-1 resume markup (tabs, file input, paste textarea, inline error). Apply these changes:

1. Add imports: `createSavedSearch`, `runDiscovery` to the existing `@/lib/api` import; add `Input`, `Label` from `@/components/ui/input` / `@/components/ui/label`.
2. Add state: `const [step, setStep] = useState<1 | 2>(1);`, `const [query, setQuery] = useState('')`, `const [location, setLocation] = useState('')`, `const [remoteOnly, setRemoteOnly] = useState(false)`.
3. Rename `finish` to `saveResume`. On success (resume saved), call `setStep(2)` instead of `router.push('/dashboard')`. Keep the no-resume inline-alert validation. Its button label becomes `Continue`.
4. Add `discover()`:

```tsx
  async function discover() {
    const trimmed = query.trim();
    if (!trimmed) {
      const message = 'Add at least one role or keyword to find jobs.';
      setError(message);
      toast.error(message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createSavedSearch({
        query: trimmed,
        location: location.trim() || undefined,
        remoteOnly,
      });
      try {
        const result = await runDiscovery();
        toast.success(
          result.inserted > 0
            ? `Found ${result.inserted} matching job${result.inserted === 1 ? '' : 's'}.`
            : 'Search saved — new jobs will appear as they’re posted.',
        );
      } catch {
        // The search is saved; discovery can run later (manual button or cron).
        toast.success('Search saved — we’ll pull matching jobs shortly.');
      }
      router.push('/jobs');
      router.refresh();
    } catch {
      toast.error('Could not save your search. Please try again.');
    } finally {
      setSaving(false);
    }
  }
```

5. Render step 2 when `step === 2` (replace the resume `CardContent` body). Use this block for the step-2 content (header text + form):

```tsx
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="role">Role or keywords</Label>
            <Input
              id="role"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value.trim()) setError(null);
              }}
              placeholder="e.g. AI Engineer, automation"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc">Location</Label>
            <Input
              id="loc"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Optional · e.g. Remote, San Francisco"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(event) => setRemoteOnly(event.target.checked)}
              className="size-4"
            />
            Remote roles only
          </label>

          {error ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button onClick={discover} disabled={saving} className="flex-1">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Find matching jobs
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                router.push('/dashboard');
                router.refresh();
              }}
              disabled={saving}
            >
              Skip for now
            </Button>
          </div>
        </CardContent>
```

6. Update the `CardHeader` title/description to reflect the step: step 1 keeps the resume copy; step 2 shows title `What roles are you targeting?` and description `We’ll pull matching postings into your feed, already scored against your resume.` Wrap the resume `CardContent` so it only renders when `step === 1`, and the step-2 `CardContent` only when `step === 2`. Keep the `Sparkles` icon block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/app/onboarding/onboarding-page.test.tsx`
Expected: PASS (3 tests).

Then: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/web/src/app/onboarding/page.tsx apps/web/src/app/onboarding/onboarding-page.test.tsx && git commit -F - <<'EOF'
feat(web): onboarding step 2 captures target roles → first discovery (#119)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 2: Move the discovery panel from Settings into Jobs

**Files:**
- Modify: `apps/web/src/app/(app)/jobs/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Add the discovery panel to the Jobs page**

In `apps/web/src/app/(app)/jobs/page.tsx`:

Add the import:
```ts
import { SavedSearchesManager } from '@/components/saved-searches';
```

Insert a discovery `SectionCard` directly above the existing "Job pipeline" `SectionCard`:
```tsx
      <SectionCard
        title="Find new jobs"
        description="Save target searches, then pull real postings into your pipeline — already scored against your resume."
      >
        <SavedSearchesManager />
      </SectionCard>
```

- [ ] **Step 2: Remove the discovery panel from Settings**

In `apps/web/src/app/(app)/settings/page.tsx`:

Remove the import `import { SavedSearchesManager } from '@/components/saved-searches';` (line 3).

Remove the entire "Job discovery" `SectionCard` block:
```tsx
      <SectionCard title="Job discovery" description="Save searches, then pull real postings into your CRM.">
        <SavedSearchesManager />
      </SectionCard>
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run typecheck && npm run lint`
Expected: no errors (verifies no dangling `SavedSearchesManager` reference in Settings).

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add "apps/web/src/app/(app)/jobs/page.tsx" "apps/web/src/app/(app)/settings/page.tsx" && git commit -F - <<'EOF'
feat(web): move job discovery from Settings into the Jobs tab (#119)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 3: Full verification + open PR

- [ ] **Step 1: Run the full web suite + API suite**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm test`
Expected: all PASS.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node scripts/run-tests.mjs`
Expected: all PASS (unchanged — PR B is web-only).

- [ ] **Step 2: Push and open the PR**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git push -u origin feat/jobs-feed-pr-b
```

Then open the PR with `gh pr create` (base `main`), title `feat: discovery in the Jobs tab + onboarding step 2 (#118 → #119 · PR B)`, body summarising the relocation + onboarding wizard, ending with the Generated-with line.

---

## Self-review notes
- **Spec coverage:** 2.1 (relocate discovery → Jobs, remove Settings copy) = Task 2; 2.2 (onboarding criteria capture → first saved search + discovery) = Task 1.
- **Type consistency:** `createSavedSearch({ query, location?, remoteOnly? })` and `runDiscovery()` match `@/lib/api`. `step` is `1 | 2`. The no-resume validation message (`add your resume to continue`) and step-2 message (`add at least one role or keyword`) match the tests.
- **No placeholders:** all code shown in full; commands include expected output.
