import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Public surface: marketing landing + architecture page + auth pages, plus the
// generated social-share image (Next serves it at /opengraph-image with no file
// extension, so the static-asset matcher below doesn't exempt it — crawlers must
// reach it without being bounced to sign-in). Everything else requires sign-in.
const isPublicRoute = createRouteMatcher([
  '/',
  '/architecture',
  '/opengraph-image(.*)',
  '/twitter-image(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)',
    '/(api|trpc)(.*)',
  ],
};
