'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/jobs/new', label: 'Add Job' },
  { href: '/outreach', label: 'Outreach' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {navItems.map((item) => {
        const active =
          item.href === '/'
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-nav__link${active ? ' sidebar-nav__link--active' : ''}`}
          >
            <span>{item.label}</span>
            <span className="sidebar-nav__arrow">→</span>
          </Link>
        );
      })}
    </nav>
  );
}
