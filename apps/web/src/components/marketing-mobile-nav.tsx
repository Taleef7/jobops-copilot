'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, Sparkles, Layers, ArrowRight } from 'lucide-react';
import { SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetHeader,
} from '@/components/ui/sheet';

interface MarketingMobileNavProps {
  signedIn: boolean;
}

export function MarketingMobileNav({ signedIn }: MarketingMobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sm:hidden flex items-center gap-1.5">
      <ModeToggle />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-9 p-0"
              aria-label="Open navigation menu"
            />
          }
        >
          <Menu className="size-5" />
        </SheetTrigger>

        <SheetContent side="top" className="border-b p-5 shadow-2xl">
          <SheetHeader className="p-0 mb-1">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Link
              href="/#features"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Sparkles className="size-4 text-primary" />
              Features
            </Link>
            <Link
              href="/architecture"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Layers className="size-4 text-primary" />
              Architecture
            </Link>

            <div className="my-1 border-t border-border/50" />

            {signedIn ? (
              <div className="flex items-center justify-between gap-3 pt-1">
                <Button
                  render={
                    <Link href="/dashboard" onClick={() => setOpen(false)}>
                      Dashboard <ArrowRight className="size-3.5" />
                    </Link>
                  }
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
                    onClick={() => setOpen(false)}
                  >
                    Sign in
                  </Button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <Button
                    className="w-full justify-center gap-1.5"
                    size="sm"
                    onClick={() => setOpen(false)}
                  >
                    Get started free <ArrowRight className="size-3.5" />
                  </Button>
                </SignUpButton>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
