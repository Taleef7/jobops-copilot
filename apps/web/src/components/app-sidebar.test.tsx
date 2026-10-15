import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/jobs' }));
// The sidebar primitives need a provider and matchMedia; this test is about the copy inside them.
vi.mock('@/components/ui/sidebar', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: Pass,
    SidebarContent: Pass,
    SidebarGroup: Pass,
    SidebarGroupContent: Pass,
    SidebarHeader: Pass,
    SidebarMenu: Pass,
    SidebarMenuItem: Pass,
    SidebarMenuButton: ({ render }: { render?: React.ReactNode }) => <div>{render}</div>,
    SidebarRail: () => null,
  };
});

import { AppSidebar } from './app-sidebar';

// #356: the same lockup as the sign-in page, the name alone, without "AI Operations".
it('shows the name alone in the brand lockup', () => {
  render(<AppSidebar />);

  const home = screen.getAllByRole('link').find((link) => link.textContent?.includes('JobOps Copilot'));
  expect(home).toHaveTextContent(/^JobOps Copilot$/);
  expect(screen.queryByText(/operations/i)).not.toBeInTheDocument();
});
