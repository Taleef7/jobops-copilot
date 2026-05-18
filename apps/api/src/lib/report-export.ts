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

async function writeLocalExport(report: WeeklyReportRecord, markdown: string) {
  const localPath = buildLocalWeeklyReportExportPath(report);
  await mkdir(join(process.cwd(), 'data', 'report-exports'), { recursive: true });
  await writeFile(localPath, markdown, 'utf8');

  return localPath;
}

export async function exportWeeklyReportMarkdown(
  report: WeeklyReportRecord,
  options: { publicBaseUrl?: string } = {},
) {
  const markdown = buildMarkdown(report);
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  const containerName =
    process.env.AZURE_STORAGE_CONTAINER_NAME?.trim() ??
    process.env.AZURE_BLOB_REPORTS_CONTAINER?.trim();
  const publicBaseUrl =
    options.publicBaseUrl?.trim() ?? process.env.API_PUBLIC_BASE_URL?.trim() ?? 'http://127.0.0.1:4000';

  if (!connectionString || !containerName) {
    await writeLocalExport(report, markdown);
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
    console.warn('Azure Blob export failed; falling back to local file export.', error);
    await writeLocalExport(report, markdown);
    return buildWeeklyReportExportUrl(report, publicBaseUrl);
  }
}
