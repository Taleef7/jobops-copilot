'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown by the *root* layout itself — where the
 * (app)/error.tsx boundary can't reach and the app's providers/styles aren't
 * mounted. It must render its own <html>/<body>, so styling is inline and
 * self-contained rather than relying on globals.css or the theme provider.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0b0e14',
          color: '#e5e7eb',
        }}
      >
        <main role="alert" style={{ maxWidth: '28rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '1.5rem' }}>
            The application hit an unexpected error. Try again, and if it persists, reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#059669',
              color: 'white',
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
