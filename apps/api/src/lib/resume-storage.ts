/**
 * Resume PDF storage and SAS URL generation.
 *
 * Handles saving rendered ATS PDFs to Azure Blob Storage with short-lived SAS URLs,
 * and falls back to a local filesystem export / API download URL when Azure Storage
 * credentials are not configured.
 */
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResumeVersionRecord } from '@/types';

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, '');
}

export function buildResumePdfFileName(version: ResumeVersionRecord): string {
  const baseOrTailored = version.isBase ? 'base' : `job_${version.jobId || 'tailored'}`;
  return `resume_${version.userId}_${baseOrTailored}_${version.id}.pdf`;
}

export function buildLocalResumePdfPath(version: ResumeVersionRecord): string {
  const exportDir = join(process.cwd(), 'data', 'resume-pdfs');
  return join(exportDir, buildResumePdfFileName(version));
}

export function buildResumeDownloadApiUrl(version: ResumeVersionRecord, publicBaseUrl: string): string {
  return new URL(`/api/profile/base-resume/versions/${version.id}/download`, normalizeBaseUrl(publicBaseUrl)).href;
}

/**
 * Best-effort local file write of the PDF buffer.
 */
async function writeLocalPdf(version: ResumeVersionRecord, pdfBuffer: Buffer): Promise<string | null> {
  try {
    const localPath = buildLocalResumePdfPath(version);
    await mkdir(join(process.cwd(), 'data', 'resume-pdfs'), { recursive: true });
    await writeFile(localPath, pdfBuffer);
    return localPath;
  } catch (error) {
    console.warn(
      'Local resume PDF write failed (read-only filesystem?); API download will regenerate dynamically.',
      error,
    );
    return null;
  }
}

/**
 * Parses AccountName and AccountKey from a standard Azure Storage connection string.
 */
function parseConnectionString(connectionString: string): { accountName?: string; accountKey?: string } {
  const parts = connectionString.split(';');
  let accountName: string | undefined;
  let accountKey: string | undefined;

  for (const part of parts) {
    const [key, ...vals] = part.split('=');
    const val = vals.join('=');
    if (key?.trim() === 'AccountName') accountName = val.trim();
    if (key?.trim() === 'AccountKey') accountKey = val.trim();
  }
  return { accountName, accountKey };
}

/**
 * Generates a short-lived (default: 1 hour) User Delegation or Shared Key SAS URL for downloading a blob.
 */
export function generateShortLivedSasUrl(
  connectionString: string,
  containerName: string,
  blobName: string,
  expiresInMinutes = 60,
): string | null {
  try {
    const { accountName, accountKey } = parseConnectionString(connectionString);
    if (!accountName || !accountKey) return null;

    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const startsOn = new Date(Date.now() - 5 * 60 * 1000); // 5 mins clock skew grace
    const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    const sasPermissions = BlobSASPermissions.parse('r'); // read only
    const sasToken = generateBlobSASQueryParameters(
      {
        containerName,
        blobName,
        permissions: sasPermissions,
        startsOn,
        expiresOn,
      },
      sharedKeyCredential,
    ).toString();

    return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
  } catch (error) {
    console.warn('Could not generate SAS URL for blob:', error);
    return null;
  }
}

/**
 * Uploads a rendered resume PDF buffer to Azure Blob Storage (or local fallback)
 * and returns the appropriate download/access URL (short-lived SAS or API URL).
 */
export async function storeResumePdf(
  version: ResumeVersionRecord,
  pdfBuffer: Buffer,
  options: { publicBaseUrl?: string } = {},
): Promise<{ fileUrl: string; isRemote: boolean }> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  const containerName =
    process.env.AZURE_STORAGE_CONTAINER_NAME?.trim() ||
    process.env.AZURE_BLOB_RESUMES_CONTAINER?.trim() ||
    'resumes';
  const publicBaseUrl =
    options.publicBaseUrl?.trim() ?? process.env.API_PUBLIC_BASE_URL?.trim() ?? 'http://127.0.0.1:4000';

  if (!connectionString) {
    await writeLocalPdf(version, pdfBuffer);
    return {
      fileUrl: buildResumeDownloadApiUrl(version, publicBaseUrl),
      isRemote: false,
    };
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blobName = `${version.userId}/${buildResumePdfFileName(version)}`;
    const blobClient = containerClient.getBlockBlobClient(blobName);

    await blobClient.upload(pdfBuffer, pdfBuffer.length, {
      blobHTTPHeaders: {
        blobContentType: 'application/pdf',
      },
    });

    await writeLocalPdf(version, pdfBuffer);

    // Try creating a short-lived SAS URL
    const sasUrl = generateShortLivedSasUrl(connectionString, containerName, blobName, 60);
    return {
      fileUrl: sasUrl || blobClient.url,
      isRemote: true,
    };
  } catch (error) {
    console.warn('Azure Blob upload for resume PDF failed; using API download URL fallback.', error);
    await writeLocalPdf(version, pdfBuffer);
    return {
      fileUrl: buildResumeDownloadApiUrl(version, publicBaseUrl),
      isRemote: false,
    };
  }
}
