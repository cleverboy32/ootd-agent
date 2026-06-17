import { NextRequest } from 'next/server';

/** Resolve client IP from reverse-proxy headers (Vercel / nginx / etc.). */
export function resolveClientIp(req: NextRequest): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return undefined;
}
