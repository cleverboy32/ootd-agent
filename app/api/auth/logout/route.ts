import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/currentUser';
import { clearSessionCookie } from '@/server/auth/sessionCookie';
import { logAuthEvent } from '@/server/logging/authAudit';

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  await logAuthEvent({
    action: 'logout',
    outcome: 'success',
    username: user?.username,
    userId: user?.id,
  });
  return response;
}
