import type { NextRequest } from 'next/server';
import { readBoundedBody } from '@/lib/edge-guard';

/**
 * Where the report-only Content-Security-Policy sends its violations (#347), so the policy
 * can be enforced once it has run two weeks without any. Public: signed-out pages report too.
 *
 * One line per violation, with only the directive, the blocked origin and the page path.
 * A full URL can carry tokens.
 */

export const dynamic = 'force-dynamic';

const MAX_REPORT_BYTES = 16 * 1024;

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

function pathOf(value: unknown): string {
  try {
    return new URL(String(value)).pathname;
  } catch {
    return 'unknown';
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
  const body = await readBoundedBody(request, MAX_REPORT_BYTES);
  if (body instanceof Response) return body;

  let payload: unknown = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(body ?? new ArrayBuffer(0)));
  } catch {
    return new Response(null, { status: 204 });
  }

  for (const violation of violationsIn(payload).slice(0, 20)) {
    const directive = String(violation.directive ?? 'unknown').replace(/[^a-z-]/gi, '').slice(0, 40);
    console.warn(`[csp-report] ${directive} blocked=${originOf(violation.blocked)} page=${pathOf(violation.page)}`);
  }
  return new Response(null, { status: 204 });
}
