import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/currentUser';

/** 登录态探针：永不 401，前端据此决定是否跳登录页 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  const questions = Array.isArray(user.securityQuestions) ? user.securityQuestions : [];
  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      hasSecurityQuestions: questions.length > 0,
    },
  });
}
