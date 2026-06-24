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

function isBlockedV6(ip: string): boolean {
  const addr = (ip.toLowerCase().split('%')[0]) as string; // drop any zone id
  if (addr === '::1' || addr === '::') return true;
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedV4(mapped[1] as string);
  if (addr.startsWith('fe80')) return true; // link-local fe80::/10
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  return false;
}

/** True when an IP literal is in a private/loopback/link-local/metadata range. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not a valid IP literal — block defensively
}

/** Validate a user-supplied URL for server-side fetching (scheme + resolved IP). */
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
