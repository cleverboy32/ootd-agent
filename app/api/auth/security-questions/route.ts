import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeSecurityAnswer,
  normalizeUsername,
  validateSecurityQuestions,
  type SecurityQuestionInput,
} from '@/server/auth/credentials';
import { getSessionUser } from '@/server/auth/currentUser';
import { hashSecret } from '@/server/auth/password';
import prismadb from '@/server/db';
import { logAuthEvent } from '@/server/logging/authAudit';

interface StoredSecurityQuestion {
  question: string;
  answerHash: string;
}

function parseStoredQuestions(raw: unknown): StoredSecurityQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is StoredSecurityQuestion =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as StoredSecurityQuestion).question === 'string' &&
      typeof (item as StoredSecurityQuestion).answerHash === 'string'
  );
}

/** GET ?username=x：找回密码时取问题文本；用户不存在统一返回空数组（避免用户名枚举） */
export async function GET(req: NextRequest) {
  const username = normalizeUsername(req.nextUrl.searchParams.get('username') ?? '');
  if (!username) {
    return NextResponse.json({ questions: [] });
  }

  try {
    const user = await prismadb.user.findUnique({ where: { username } });
    const questions = user ? parseStoredQuestions(user.securityQuestions) : [];
    return NextResponse.json({ questions: questions.map((q) => q.question) });
  } catch (error) {
    console.error('[AUTH_SECURITY_QUESTIONS_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

interface SetQuestionsBody {
  questions?: unknown;
}

/** POST：登录态设置/覆盖密保问题（答案归一化后哈希存储） */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as SetQuestionsBody | null;
  const inputs = Array.isArray(body?.questions) ? (body.questions as SecurityQuestionInput[]) : [];

  const validationError = validateSecurityQuestions(inputs);
  if (validationError) {
    return NextResponse.json({ error: validationError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const stored: StoredSecurityQuestion[] = [];
    for (const input of inputs) {
      stored.push({
        question: input.question.trim(),
        answerHash: await hashSecret(normalizeSecurityAnswer(input.answer)),
      });
    }

    await prismadb.user.update({
      where: { id: user.id },
      data: { securityQuestions: stored as unknown as Prisma.InputJsonValue },
    });
    await logAuthEvent({
      action: 'set_security_questions',
      outcome: 'success',
      username: user.username,
      userId: user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[AUTH_SECURITY_QUESTIONS_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
