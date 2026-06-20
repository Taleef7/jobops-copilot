import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobops-web.azurewebsites.net';
const siteTitle = 'JobOps Copilot — AI Job Search Platform';
const siteDescription =
  'An AI-agent operations platform for the job search: track roles, analyze fit with RAG, run multi-step agents, and surface time-series insights — human-approved at every step.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: '%s · JobOps Copilot',
  },
  description: siteDescription,
  applicationName: 'JobOps Copilot',
  // og:image from app/opengraph-image.tsx; twitter:image from app/twitter-image.tsx.
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'JobOps Copilot',
    title: siteTitle,
    description: siteDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      appearance={{ variables: { colorPrimary: '#059669', borderRadius: '0.6rem' } }}
    >
      <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
        <body className="min-h-svh antialiased">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <TooltipProvider>
              {children}
              <Toaster richColors closeButton position="top-right" />
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
