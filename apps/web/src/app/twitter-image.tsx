// Emit explicit twitter:image* tags reusing the same card as opengraph-image.
// Without this file Twitter would only inherit the OG image via Next's implicit
// twitter→openGraph fallback, which silently breaks if twitter.images is ever set.
export { default, alt, size, contentType } from './opengraph-image';
