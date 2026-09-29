/**
 * True when running as a real deployment: an explicit `NODE_ENV=production`, or an Azure
 * runtime (App Service sets `WEBSITE_SITE_NAME`, Container Apps sets `CONTAINER_APP_NAME`).
 * Read dynamically so a misconfigured deploy is caught regardless of how prod is signalled.
 */
export function inProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'production' ||
    Boolean(env.WEBSITE_SITE_NAME?.trim()) ||
    Boolean(env.CONTAINER_APP_NAME?.trim())
  );
}
