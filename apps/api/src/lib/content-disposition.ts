/**
 * A `Content-Disposition: attachment` header for any file name (RFC 6266): an ASCII
 * `filename` for old clients and a UTF-8 `filename*`. Node refuses a header value with a
 * character above U+00FF, so a name such as "Łukasz" in the plain `filename` was a 500.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_').trim() || 'download';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
