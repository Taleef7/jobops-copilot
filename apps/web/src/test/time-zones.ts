import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { onTestFinished, vi } from 'vitest';

/**
 * The server renders in UTC (Azure) and the browser in the user's zone, America/New_York in
 * these tests (vitest.config.mts). From 8 pm in New York it's already tomorrow in UTC (#412).
 */
function switchToUtc() {
  const browserZone = process.env.TZ;
  const restore = () => {
    if (browserZone === undefined) delete process.env.TZ;
    else process.env.TZ = browserZone;
  };
  process.env.TZ = 'UTC';
  // Node applies a new TZ at once in a process's main thread, not in a worker thread.
  if (new Date('2026-10-15T00:00:00Z').getTimezoneOffset() !== 0) {
    restore();
    throw new Error("Couldn't switch to UTC: run the tests in forks, not threads.");
  }
  return restore;
}

/** The HTML the server sends for a client component. */
export function renderOnServer(ui: ReactNode): string {
  const restore = switchToUtc();
  try {
    return renderToString(ui);
  } finally {
    restore();
  }
}

/** The HTML the server sends for a server component, such as a page: it runs in UTC too. */
export async function renderPageOnServer(page: () => Promise<ReactNode>): Promise<string> {
  const restore = switchToUtc();
  try {
    return renderToString(await page());
  } finally {
    restore();
  }
}

/**
 * Hydrates the server's HTML in the browser's zone. `hydrationErrors` gets React's recoverable
 * errors (#418, a different text) and what it logs meanwhile (a different attribute, which it
 * only logs and leaves as the server rendered it). The page is removed when the test ends.
 */
export async function hydrateInBrowser(html: string, ui: ReactNode) {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const hydrationErrors = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(hydrationErrors);
  let root: Root | undefined;
  onTestFinished(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    container.remove();
  });
  try {
    await act(async () => {
      root = hydrateRoot(container, ui, { onRecoverableError: hydrationErrors });
    });
  } finally {
    consoleError.mockRestore();
  }
  return { container, hydrationErrors };
}
