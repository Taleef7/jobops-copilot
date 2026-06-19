import { BlobServiceClient } from '@azure/storage-blob';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WeeklyReportRecord } from '@/types';

export function buildWeeklyReportExportFileName(report: WeeklyReportRecord) {
  return `weekly-report_${report.weekStart}_to_${report.weekEnd}_${report.id}.md`;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, '');
}

function buildMarkdown(report: WeeklyReportRecord) {
  return report.reportMarkdown.endsWith('\n') ? report.reportMarkdown : `${report.reportMarkdown}\n`;
}

export function buildLocalWeeklyReportExportPath(report: WeeklyReportRecord) {
  const exportDir = join(process.cwd(), 'data', 'report-exports');
  return join(exportDir, buildWeeklyReportExportFileName(report));
}

export function buildWeeklyReportExportUrl(report: WeeklyReportRecord, publicBaseUrl: string) {
  return new URL(`/api/reports/${report.id}/export`, normalizeBaseUrl(publicBaseUrl)).href;
}

/**
 * Best-effort local cache of the export markdown. Never throws: the prod App Service
 * filesystem is read-only (WEBSITE_RUN_FROM_PACKAGE=1), and the download route
 * (`/api/reports/:id/export`) regenerates from the DB-stored markdown when this file
 * is absent — so a failed write must not break report generation (QA·C). Returns the
 * written path, or null when the write was skipped/failed.
 */
async function writeLocalExport(report: WeeklyReportRecord, markdown: string): Promise<string | null> {
  try {
    const localPath = buildLocalWeeklyReportExportPath(report);
    await mkdir(join(process.cwd(), 'data', 'report-exports'), { recursive: true });
    await writeFile(localPath, markdown, 'utf8');
    return localPath;
  } catch (error) {
    console.warn(
      'Local weekly-report export write failed (read-only filesystem?); the download route will fall back to the stored markdown.',
      error,
    );
    return null;
  }
}

export async function exportWeeklyReportMarkdown(
  report: WeeklyReportRecord,
  options: { publicBaseUrl?: string } = {},
) {
  const markdown = buildMarkdown(report);
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  const containerName =
    process.env.AZURE_STORAGE_CONTAINER_NAME?.trim() ||
    process.env.AZURE_BLOB_REPORTS_CONTAINER?.trim();
  const publicBaseUrl =
    options.publicBaseUrl?.trim() ?? process.env.API_PUBLIC_BASE_URL?.trim() ?? 'http://127.0.0.1:4000';

  if (!connectionString || !containerName) {
    await writeLocalExport(report, markdown);
    // Built only on the fallback paths: the blob-success branch returns blobClient.url
    // and must not depend on (or throw on) a malformed request-derived base URL.
    return buildWeeklyReportExportUrl(report, publicBaseUrl);
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blobClient = containerClient.getBlockBlobClient(
      `weekly-reports/${report.weekStart}/${buildWeeklyReportExportFileName(report)}`,
    );

    await blobClient.upload(markdown, Buffer.byteLength(markdown), {
      blobHTTPHeaders: {
        blobContentType: 'text/markdown; charset=utf-8',
      },
    });

    await writeLocalExport(report, markdown);
    return blobClient.url;
  } catch (error) {
    console.warn('Azure Blob export failed; returning the API export URL (DB-backed).', error);
    await writeLocalExport(report, markdown);
    return buildWeeklyReportExportUrl(report, publicBaseUrl);
  }
}
