import type { MetadataRoute } from 'next';

/**
 * /robots.txt — JobOps Copilot is an authenticated personal job-search CRM, so the
 * signed-in app routes and the API hold per-user data that must not be crawled or
 * indexed. Public/marketing pages stay crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard',
        '/jobs',
        '/outreach',
        '/reports',
        '/assistant',
        '/settings',
        '/onboarding',
      ],
    },
  };
}
