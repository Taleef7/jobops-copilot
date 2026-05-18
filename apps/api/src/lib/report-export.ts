import { BlobServiceClient } from '@azure/storage-blob';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WeeklyReportRecord } from '@/types';

function reportFileName(report: WeeklyReportRecord) {
  return `weekly-report_${report.weekStart}_to_${report.weekEnd}_${report.id}.md`;
}

function buildMarkdown(report: WeeklyReportRecord) {
  return report.reportMarkdown.endsWith('\n') ? report.reportMarkdown : `${report.reportMarkdown}\n`;
}

async function writeLocalExport(report: WeeklyReportRecord, markdown: string) {
  const exportDir = join(process.cwd(), 'data', 'report-exports');
  await mkdir(exportDir, { recursive: true });

  const localPath = join(exportDir, reportFileName(report));
  await writeFile(localPath, markdown, 'utf8');

  return pathToFileURL(localPath).href;
}

export async function exportWeeklyReportMarkdown(report: WeeklyReportRecord) {
  const markdown = buildMarkdown(report);
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  const containerName = process.env.AZURE_BLOB_REPORTS_CONTAINER?.trim();

  if (!connectionString || !containerName) {
    return writeLocalExport(report, markdown);
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blobClient = containerClient.getBlockBlobClient(
      `weekly-reports/${report.weekStart}/${reportFileName(report)}`,
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
    return writeLocalExport(report, markdown);
  }
}
