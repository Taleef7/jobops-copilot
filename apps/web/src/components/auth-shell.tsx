import { Sparkles } from 'lucide-react';
import Link from 'next/link';

/**
 * Frame for the sign-in / sign-up pages.
 *
 * These were a bare Clerk widget centred on an empty page: no wordmark, no
 * product name, no way back to the marketing site. That reads as a generic
 * hosted login rather than part of this product — and it is the first screen a
 * visitor sees after clicking "Get started".
 *
 * Reuses the sidebar's brand lockup verbatim (same mark, same wordmark, same
 * "AI Operations" line) so the app doesn't introduce a second identity at its
 * own front door.
 *
 * Deliberately contributes no heading of its own. Clerk's card already renders
 * one ("Sign in to JobOps Copilot"), and suppressing it would mean betting on
 * an internal `appearance.elements` key — a duplicate <h1> is a worse outcome
 * than letting Clerk own the title.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    // `min-h-dvh`, not `min-h-screen`: on mobile 100vh is the viewport with
    // browser chrome hidden, so a centred layout sits partly under the URL bar.
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Link
        href="/"
        aria-label="JobOps Copilot home"
        className="focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm">
            <Sparkles className="size-4.5" />
          </span>
          <span className="grid text-left leading-tight">
            <span className="font-heading text-base font-bold">JobOps Copilot</span>
            <span className="text-muted-foreground text-xs">AI Operations</span>
          </span>
        </span>
      </Link>

      {children}
    </div>
  );
}
