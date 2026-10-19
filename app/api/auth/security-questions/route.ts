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

/**
 * GET：
 * - 无 username + 已登录 → 返回当前用户的问题文本（不含答案），供安全中心回显
 * - ?username=x → 找回密码用问题文本；用户不存在统一空数组（避免枚举）
 */
export async function GET(req: NextRequest) {
  const usernameParam = normalizeUsername(req.nextUrl.searchParams.get('username') ?? '');

  try {
    if (!usernameParam) {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return NextResponse.json({ questions: [] });
      }
      const questions = parseStoredQuestions(sessionUser.securityQuestions);
      return NextResponse.json({
        questions: questions.map((q) => q.question),
        configured: questions.length > 0,
      });
    }

    const user = await prismadb.user.findUnique({ where: { username: usernameParam } });
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

  const validationError = validateSecurityQuestions(inputs, { allowEmptyAnswers: true });
  if (validationError) {
    return NextResponse.json({ error: validationError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const existing = parseStoredQuestions(user.securityQuestions);
    const existingByQuestion = new Map(
      existing.map((q) => [q.question.trim(), q.answerHash] as const),
    );

    const stored: StoredSecurityQuestion[] = [];
    for (const input of inputs) {
      const question = input.question.trim();
      const answerRaw = typeof input.answer === 'string' ? input.answer : '';
      const normalized = normalizeSecurityAnswer(answerRaw);
      // 答案留空且该问题已存在 → 保留原哈希（安全中心密文占位回显场景）
      const reuseHash = normalized.length === 0 ? existingByQuestion.get(question) : undefined;
      if (!reuseHash && normalized.length === 0) {
        return NextResponse.json(
          { error: '请填写密保答案', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      stored.push({
        question,
        answerHash: reuseHash ?? (await hashSecret(normalized)),
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
