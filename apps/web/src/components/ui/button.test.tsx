// These tests render plain <a> elements on purpose: the point is to assert what
// `Button` does to whatever `render` target it receives, independent of
// next/link. Callers in the app still pass <Link />.
/* eslint-disable @next/next/no-html-link-for-pages */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders a native button by default', () => {
    render(<Button>Save changes</Button>);
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button.tagName).toBe('BUTTON');
  });

  describe('rendered as a link', () => {
    // Base UI's Button applies role="button" to whatever it renders once
    // nativeButton={false}. That made every `<Button render={<Link/>}>` in the
    // app announce as a button: the "this navigates" affordance was lost, the
    // control dropped out of the screen reader's links list, and it advertised
    // Space-key activation that an anchor does not provide. Verified live on the
    // marketing nav: <a href="/architecture" role="button">.
    it('stays a link in the accessibility tree', () => {
      render(<Button render={<a href="/architecture" />}>Architecture</Button>);

      const link = screen.getByRole('link', { name: 'Architecture' });
      expect(link).toHaveAttribute('href', '/architecture');
      expect(link).not.toHaveAttribute('role');
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('still carries the button styling and slot', () => {
      render(
        <Button render={<a href="/jobs/new" />} variant="outline" size="sm">
          Add job
        </Button>,
      );

      const link = screen.getByRole('link', { name: 'Add job' });
      expect(link).toHaveAttribute('data-slot', 'button');
      // cva output for variant/size lands on the anchor itself.
      expect(link.className).toContain('border-border');
      expect(link.className).toContain('h-7');
    });

    it('preserves className already on the render target', () => {
      render(
        <Button render={<a href="/reports" className="custom-anchor" />}>Reports</Button>,
      );

      const link = screen.getByRole('link', { name: 'Reports' });
      expect(link).toHaveClass('custom-anchor');
      expect(link.className).toContain('inline-flex');
    });
  });

  it('gives a non-button, non-link render target button semantics', () => {
    // A <div> genuinely needs Base UI to supply role + keyboard handling.
    render(<Button render={<div />}>Run</Button>);
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('grows touch targets on a coarse pointer', () => {
    // Audited at 390px: every control sat between 28px and 32px tall, under the
    // 44/48px platform guidance for touch.
    render(<Button>Discover now</Button>);
    expect(screen.getByRole('button').className).toContain('pointer-coarse:h-11');
  });
});
