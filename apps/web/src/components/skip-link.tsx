/**
 * A keyboard-only "skip to main content" link. Visually hidden until focused,
 * then it appears as the first tab stop so keyboard and screen-reader users can
 * jump past the sidebar and header straight to the page's <main> landmark.
 *
 * Pairs with a `<main id="main-content" tabIndex={-1}>` target.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="bg-background ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:ring-2 focus:outline-none"
    >
      Skip to main content
    </a>
  );
}
