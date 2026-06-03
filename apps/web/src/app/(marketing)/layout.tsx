import { SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="font-heading flex items-center gap-2 font-bold">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg shadow-sm">
              <Sparkles className="size-4" />
            </span>
            JobOps Copilot
          </Link>
          <nav className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Button
              render={<a href="#features">Features</a>}
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            />
            <ModeToggle />
            {signedIn ? (
              <>
                <Button render={<Link href="/dashboard">Dashboard</Link>} size="sm" />
                <UserButton />
              </>
            ) : (
              <>
                <SignInButton mode="modal">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <Button size="sm">Get started</Button>
                </SignUpButton>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t py-8">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} JobOps Copilot — a portfolio AI-agent platform.</p>
          <p className="flex items-center gap-1.5">
            <span className="bg-primary inline-block size-2 rounded-full" />
            Human-approved AI. Never auto-sends.
          </p>
        </div>
      </footer>
    </div>
  );
}
