/**
 * A `Content-Disposition: attachment` header for any file name (RFC 6266): an ASCII
 * `filename` for old clients and a UTF-8 `filename*`. Node refuses a header value with a
 * character above U+00FF, so a name such as "Łukasz" in the plain `filename` was a 500.
 */
export function attachmentDisposition(fileName: string): string {
  // A lone surrogate (broken UTF-16) can't be percent-encoded; leave it out.
  const name = fileName.replace(/\p{Cs}/gu, '');
  // An en or em dash is a hyphen in the plain name, so "Lee – Acme" doesn't become "Lee  Acme".
  const ascii =
    name
      .normalize('NFKD')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '_')
      .trim() || 'download';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
