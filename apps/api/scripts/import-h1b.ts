import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { Pool } from 'pg';
import { normalizeEmployerName, lookupSponsorLikelihood } from '../src/lib/sponsorship';

export interface ResolvedHeaders {
  fiscalYear: string;
  employer: string;
  initialApproval?: string;
  initialDenial?: string;
  continuingApproval?: string;
  continuingDenial?: string;
}

export interface AggregatedH1bRow {
  employerName: string;
  employerNameNormalized: string;
  fiscalYear: number;
  approvals: number;
  denials: number;
}

export function resolveHeaders(headers: string[]): ResolvedHeaders {
  let fiscalYear: string | undefined;
  let employer: string | undefined;
  let initialApproval: string | undefined;
  let initialDenial: string | undefined;
  let continuingApproval: string | undefined;
  let continuingDenial: string | undefined;

  for (const header of headers) {
    const clean = header.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    if (!fiscalYear && ((clean.includes('fiscal') && clean.includes('year')) || clean === 'year')) {
      fiscalYear = header;
    }
    if (
      !employer &&
      (clean.includes('employer') || clean.includes('petitioner name') || clean === 'petitioner') &&
      !clean.includes('state') &&
      !clean.includes('city') &&
      !clean.includes('zip')
    ) {
      employer = header;
    }
    if (!initialApproval && clean.includes('initial') && clean.includes('approval')) {
      initialApproval = header;
    }
    if (!initialDenial && clean.includes('initial') && clean.includes('denial')) {
      initialDenial = header;
    }
    if (!continuingApproval && clean.includes('continuing') && clean.includes('approval')) {
      continuingApproval = header;
    }
    if (!continuingDenial && clean.includes('continuing') && clean.includes('denial')) {
      continuingDenial = header;
    }
  }

  if (!employer) {
    throw new Error('Missing required column: employer name');
  }

  if (!fiscalYear) {
    throw new Error('Missing required column: fiscal year');
  }

  return {
    fiscalYear,
    employer,
    initialApproval,
    initialDenial,
    continuingApproval,
    continuingDenial,
  };
}

function parseCount(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function parseH1bCsv(csvContent: string): Record<string, string>[] {
  return parse(csvContent, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

export function aggregateH1bRows(rows: Record<string, string>[]): AggregatedH1bRow[] {
  if (rows.length === 0) {
    return [];
  }

  const sampleRow = rows[0]!;
  const resolved = resolveHeaders(Object.keys(sampleRow));

  const map = new Map<string, AggregatedH1bRow>();

  for (const row of rows) {
    const rawEmployer = row[resolved.employer]?.trim();
    if (!rawEmployer) continue;

    const normalized = normalizeEmployerName(rawEmployer);
    if (!normalized) continue;

    const rawYear = row[resolved.fiscalYear]?.trim();
    if (!rawYear) continue;

    const fiscalYear = parseInt(rawYear.replace(/[^0-9]/g, ''), 10);
    if (Number.isNaN(fiscalYear) || fiscalYear <= 0) continue;

    const initialApproval = parseCount(resolved.initialApproval ? row[resolved.initialApproval] : undefined);
    const continuingApproval = parseCount(resolved.continuingApproval ? row[resolved.continuingApproval] : undefined);
    const initialDenial = parseCount(resolved.initialDenial ? row[resolved.initialDenial] : undefined);
    const continuingDenial = parseCount(resolved.continuingDenial ? row[resolved.continuingDenial] : undefined);

    const approvals = initialApproval + continuingApproval;
    const denials = initialDenial + continuingDenial;

    const key = `${normalized}::${fiscalYear}`;
    const existing = map.get(key);
    if (existing) {
      existing.approvals += approvals;
      existing.denials += denials;
    } else {
      map.set(key, {
        employerName: rawEmployer,
        employerNameNormalized: normalized,
        fiscalYear,
        approvals,
        denials,
      });
    }
  }

  return Array.from(map.values());
}

export async function upsertH1bRows(
  pool: Pool,
  rows: AggregatedH1bRow[],
  batchSize = 500,
): Promise<number> {
  let totalUpserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    if (batch.length === 0) continue;

    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];

    batch.forEach((row, index) => {
      const offset = index * 5;
      valuePlaceholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
      );
      values.push(
        row.employerName,
        row.employerNameNormalized,
        row.fiscalYear,
        row.approvals,
        row.denials,
      );
    });

    const query = `
      insert into h1b_sponsors (
        employer_name,
        employer_name_normalized,
        fiscal_year,
        approvals,
        denials
      ) values ${valuePlaceholders.join(', ')}
      on conflict (employer_name_normalized, fiscal_year)
      do update set
        employer_name = excluded.employer_name,
        approvals = excluded.approvals,
        denials = excluded.denials;
    `;

    await pool.query(query, values);
    totalUpserted += batch.length;
  }

  return totalUpserted;
}

export async function backfillExistingJobs(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ company: string }>(
    `select distinct company from jobs where company is not null and trim(company) != ''`,
  );

  let updatedCount = 0;
  for (const { company } of rows) {
    const sponsor = await lookupSponsorLikelihood(company, pool);
    if (sponsor) {
      const res = await pool.query(
        `update jobs set sponsor_likelihood = $1 where company = $2 and (sponsor_likelihood is null or sponsor_likelihood != $1)`,
        [JSON.stringify(sponsor), company],
      );
      updatedCount += res.rowCount ?? 0;
    }
  }

  return updatedCount;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx apps/api/scripts/import-h1b.ts <csv-path>');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run import-h1b.');
    process.exit(1);
  }

  console.log(`Reading CSV from ${csvPath}...`);
  const content = readFileSync(csvPath, 'utf8');
  const rows = parseH1bCsv(content);
  console.log(`Parsed ${rows.length} raw rows from CSV.`);

  console.log('Aggregating rows by employer and fiscal year...');
  const aggregated = aggregateH1bRows(rows);
  console.log(`Aggregated to ${aggregated.length} employer-year records.`);

  const pool = new Pool({
    connectionString: databaseUrl,
    allowExitOnIdle: true,
    max: 5,
  });

  try {
    console.log('Upserting into h1b_sponsors...');
    const upserted = await upsertH1bRows(pool, aggregated);
    console.log(`Successfully upserted ${upserted} records into h1b_sponsors.`);

    console.log('Backfilling existing jobs...');
    const backfilled = await backfillExistingJobs(pool);
    console.log(`Backfilled ${backfilled} existing job listings with sponsorship data.`);
  } finally {
    await pool.end();
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  !process.argv[1].includes('.test.') &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('import-h1b.ts') ||
    process.argv[1].endsWith('import-h1b.js'));

if (isMain) {
  main().catch((error: unknown) => {
    console.error('H1B import failed:', error);
    process.exit(1);
  });
}
