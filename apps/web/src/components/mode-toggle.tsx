'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

/**
 * Theme switch.
 *
 * Deliberately renders one button per theme and lets CSS pick which is visible,
 * rather than deriving a label from `resolvedTheme`. `resolvedTheme` is
 * undefined during SSR and the first client render, so the label was computed
 * as "Switch to dark mode" and shipped that way *while already in dark mode* —
 * the wrong action, announced to assistive tech for the whole session, and it
 * never corrected itself because nothing re-rendered until the user clicked.
 *
 * next-themes sets `class="dark"` on <html> in a blocking script before paint,
 * so the correct button is visible on first paint with no flash, and `hidden`
 * keeps the inactive one out of both the tab order and the accessibility tree.
 */
export function ModeToggle() {
  const { setTheme } = useTheme();

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="dark:hidden"
        aria-label="Switch to dark mode"
        title="Switch to dark mode"
        onClick={() => setTheme('dark')}
      >
        <Sun className="size-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden dark:inline-flex"
        aria-label="Switch to light mode"
        title="Switch to light mode"
        onClick={() => setTheme('light')}
      >
        <Moon className="size-5" />
      </Button>
    </>
  );
}
