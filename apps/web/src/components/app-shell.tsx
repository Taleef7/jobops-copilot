import Link from 'next/link';
import { AppNav } from '@/components/app-nav';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <Link href="/" className="brand">
          <span className="brand__mark">JO</span>
          <span>
            <strong>JobOps Copilot</strong>
            <small>Managed job-search operations</small>
          </span>
        </Link>

        <div className="sidebar-callout">
          <p>Phase 0 foundation</p>
          <strong>Mock data enabled</strong>
          <span>Frontend, API, docs, prompts, and SQL drafts are wired for the next phase.</span>
        </div>

        <AppNav />

        <div className="sidebar-footer">
          <span className="sidebar-footer__label">Operating mode</span>
          <strong>Human approval only</strong>
          <span>Drafts, scores, and reports are generated for review, not auto-sent.</span>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div>
            <p className="eyebrow">AI JobOps Copilot</p>
            <h1 className="app-topbar__title">Job search CRM and automation control center</h1>
          </div>
          <div className="topbar-badges">
            <span className="topbar-badge">Next.js App Router</span>
            <span className="topbar-badge">Express API</span>
            <span className="topbar-badge">Azure-ready</span>
          </div>
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}
