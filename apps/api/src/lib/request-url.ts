import type { Request } from 'express';

export function getRequestBaseUrl(request: Request) {
  const forwardedProto = request.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.header('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || request.protocol || 'http';
  const host = forwardedHost || request.get('host') || '127.0.0.1:4000';

  return `${protocol}://${host}`;
}
