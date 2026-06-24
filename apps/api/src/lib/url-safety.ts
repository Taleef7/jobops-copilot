import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type LookupFn = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const a = parts[0] as number;
  const b = parts[1] as number;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isBlockedV6(ip: string): boolean {
  const addr = (ip.toLowerCase().split('%')[0]) as string; // drop any zone id
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  // IPv4-mapped ::ffff:a.b.c.d (dotted) and ::ffff:HHHH:HHHH (hex-word) forms.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedV4(mapped[1] as string);
  const mappedHex = addr.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (mappedHex) {
    return isBlockedV4(v4FromGroups(parseInt(mappedHex[1] as string, 16), parseInt(mappedHex[2] as string, 16)));
  }
  // IPv4-compatible (deprecated) ::a.b.c.d — e.g. ::169.254.169.254.
  const compat = addr.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (compat) return isBlockedV4(compat[1] as string);
  // 6to4 (2002::/16) and Teredo (2001:0::/32) embed/relay IPv4 — deprecated; block wholesale.
  if (addr.startsWith('2002:') || addr.startsWith('2001:0:')) return true;
  // Numeric range checks on the first 16-bit group (string prefixes miss
  // fe81–febf and fc/fd written non-canonically).
  const head = parseInt(addr.split(':')[0] as string, 16);
  if (head >= 0xfe80 && head <= 0xfebf) return true; // link-local fe80::/10
  if (head >= 0xfc00 && head <= 0xfdff) return true; // unique-local fc00::/7
  return false;
}

/** True when an IP literal is in a private/loopback/link-local/metadata range. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not a valid IP literal — block defensively
}

/**
 * Validate a user-supplied URL for server-side fetching (scheme + resolved IP).
 *
 * IMPORTANT: this check is point-in-time. The returned `url` is re-resolved by
 * the OS when handed to `fetch`, leaving a DNS-rebinding (TOCTOU) window. The
 * caller mitigates by following redirects manually and re-validating every hop
 * (see `job-url-fetch.ts`); do not treat the returned `url` as unconditionally
 * safe to fetch.
 */
export async function assertUrlSafe(
  rawUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Enter a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are supported.' };
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname);
  } catch {
    return { ok: false, reason: 'Could not resolve that host.' };
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    return { ok: false, reason: 'That URL points to a private or disallowed address.' };
  }
  return { ok: true, url };
}
