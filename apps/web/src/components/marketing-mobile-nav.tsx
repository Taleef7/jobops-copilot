'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, Sparkles, Layers, ArrowRight } from 'lucide-react';
import { SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';

interface MarketingMobileNavProps {
  signedIn: boolean;
}

export function MarketingMobileNav({ signedIn }: MarketingMobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="sm:hidden flex items-center gap-1.5">
      <ModeToggle />
      <Button
        variant="ghost"
        size="icon"
        className="size-9 p-0"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isOpen}
      >
        {isOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </Button>

      {isOpen && (
        <>
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 top-16 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          {/* Dropdown panel */}
          <div
            className="fixed inset-x-0 top-16 z-50 border-b border-border bg-background p-5 shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-top-2"
          >
          <div className="flex flex-col gap-3">
            <Link
              href="/#features"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Sparkles className="size-4 text-primary" />
              Features
            </Link>
            <Link
              href="/architecture"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Layers className="size-4 text-primary" />
              Architecture
            </Link>

            <div className="my-1 border-t border-border/50" />

            {signedIn ? (
              <div className="flex items-center justify-between gap-3 pt-1">
                <Button
                  render={<Link href="/dashboard" onClick={() => setIsOpen(false)}>Dashboard <ArrowRight className="size-3.5" /></Link>}
                  className="flex-1 justify-center gap-1.5"
                  size="sm"
                />
                <UserButton />
              </div>
            ) : (
              <div className="flex flex-col gap-2 pt-1">
                <SignInButton mode="modal">
                  <Button
                    variant="outline"
                    className="w-full justify-center"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                  >
                    Sign in
                  </Button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <Button
                    className="w-full justify-center gap-1.5"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                  >
                    Get started free <ArrowRight className="size-3.5" />
                  </Button>
                </SignUpButton>
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
