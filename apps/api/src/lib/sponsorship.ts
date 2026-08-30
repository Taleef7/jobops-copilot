import { getPool } from '@/lib/postgres';
import type { Pool } from 'pg';
import type { SponsorLikelihood } from '@/types';

export const CORPORATE_SUFFIXES: readonly string[] = [
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'limited',
  'llp',
  'lp',
  'pllc',
  'pc',
  'holdings',
  'holding',
  'group',
  'services',
  'technologies',
  'technology',
  'solutions',
  'consulting',
  'usa',
  'us',
  'na',
  'america',
];

export function normalizeEmployerName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  let normalized = name.toLowerCase().replace(/&/g, ' and ');
  normalized = normalized.replace(/\./g, '');
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');

  const tokens = normalized.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return '';
  }

  const suffixSet = new Set(CORPORATE_SUFFIXES);
  while (tokens.length > 1 && suffixSet.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }

  return tokens.join(' ');
}

export const LOOKBACK_YEARS = 3;

export async function lookupSponsorLikelihood(
  company: string,
  poolOverride?: Pool | null,
): Promise<SponsorLikelihood | null> {
  try {
    if (!company || !company.trim()) {
      return null;
    }

    const pool = poolOverride !== undefined ? poolOverride : getPool();
    if (!pool) {
      return null;
    }

    const normalized = normalizeEmployerName(company);
    if (!normalized) {
      return null;
    }

    const { rows } = await pool.query<{ approvals: number | string; denials: number | string }>(
      `select
        coalesce(sum(approvals), 0)::int as approvals,
        coalesce(sum(denials), 0)::int as denials
      from h1b_sponsors
      where employer_name_normalized = $1
        and fiscal_year >= (select coalesce(max(fiscal_year), 0) from h1b_sponsors) - $2`,
      [normalized, LOOKBACK_YEARS - 1],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const approvals = Number(rows[0]?.approvals ?? 0);
    const denials = Number(rows[0]?.denials ?? 0);

    if (approvals + denials > 0) {
      return {
        status: 'known_sponsor',
        approvals,
        denials,
      };
    }

    return null;
  } catch {
    return null;
  }
}
