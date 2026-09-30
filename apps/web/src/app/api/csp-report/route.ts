import type { NextRequest } from 'next/server';
import { takeCspReportLine } from '@/lib/csp-report-limit';
import { appOrigin, readBoundedBody } from '@/lib/edge-guard';

/**
 * Where the report-only Content-Security-Policy sends its violations (#347), so the policy
 * can be enforced once it has run two weeks without any. Public: signed-out pages report too.
 *
 * One line per violation, with only the directive, the blocked origin and the page path.
 * A full URL can carry tokens. Being public, it logs only the content types browsers send,
 * only reports about this app's own pages (another site could point its CSP here), at
 * most five per request and 60 lines a minute.
 */

export const dynamic = 'force-dynamic';

const MAX_REPORT_BYTES = 16 * 1024;
const MAX_VIOLATIONS_PER_REPORT = 5;
const REPORT_TYPES = new Set(['application/csp-report', 'application/reports+json']);

type Violation = { page?: unknown; directive?: unknown; blocked?: unknown };

/** `https://host` for a URL, the keyword itself for `inline`, `eval`, `data` and the like. */
function originOf(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return 'unknown';
  try {
    return new URL(text).origin;
  } catch {
    return text.replace(/[^a-z-]/gi, '').slice(0, 40) || 'unknown';
  }
}

/** The page path, when the page is on this app's origin; otherwise null. */
function ownPagePath(value: unknown, origin: string): string | null {
  try {
    const url = new URL(String(value));
    return url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

function violationsIn(payload: unknown): Violation[] {
  // Reporting API: an array of reports.
  if (Array.isArray(payload)) {
    return payload
      .filter((entry) => entry?.type === 'csp-violation' && entry.body)
      .map(({ body }) => ({ page: body.documentURL, directive: body.effectiveDirective, blocked: body.blockedURL }));
  }
  // Classic report-uri: { "csp-report": { ... } }.
  const report = (payload as { 'csp-report'?: Record<string, unknown> } | null)?.['csp-report'];
  if (!report) return [];
  return [
    {
      page: report['document-uri'],
      directive: report['effective-directive'] ?? report['violated-directive'],
      blocked: report['blocked-uri'],
    },
  ];
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!REPORT_TYPES.has(contentType)) return new Response(null, { status: 415 });
  const body = await readBoundedBody(request, MAX_REPORT_BYTES);
  if (body instanceof Response) return body;

  let payload: unknown = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(body ?? new ArrayBuffer(0)));
  } catch {
    return new Response(null, { status: 204 });
  }

  const origin = appOrigin(request);
  for (const violation of violationsIn(payload).slice(0, MAX_VIOLATIONS_PER_REPORT)) {
    const page = ownPagePath(violation.page, origin);
    if (!page || !takeCspReportLine(console.warn)) continue;
    const directive = String(violation.directive ?? 'unknown').replace(/[^a-z-]/gi, '').slice(0, 40);
    console.warn(`[csp-report] ${directive} blocked=${originOf(violation.blocked)} page=${page}`);
  }
  return new Response(null, { status: 204 });
}
