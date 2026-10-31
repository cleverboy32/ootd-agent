import { NextRequest, NextResponse } from 'next/server';
import { createRedeemCode, grantCredits } from '@/server/billing/credits';
import { CREDIT_REASON } from '@/server/config/credits';
import prismadb from '@/server/db';

function assertAdminSecret(req: NextRequest): boolean {
  const expected = process.env.BILLING_ADMIN_SECRET?.trim();
  if (!expected) return false;
  const header = req.headers.get('x-billing-admin-secret')?.trim();
  return Boolean(header && header === expected);
}

interface GrantBody {
  /** 按 userId 或 username 加额 */
  userId?: unknown;
  username?: unknown;
  amount?: unknown;
  note?: unknown;
}

interface CreateCodeBody {
  action?: 'create_code';
  plainCode?: unknown;
  credits?: unknown;
  maxUses?: unknown;
  expiresAt?: unknown;
  note?: unknown;
}

/**
 * POST /api/billing/admin/grant
 * Header: x-billing-admin-secret
 *
 * 加额：{ userId|username, amount, note? }
 * 建码：{ action: "create_code", plainCode, credits, maxUses?, expiresAt?, note? }
 */
export async function POST(req: NextRequest) {
  if (!assertAdminSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as (GrantBody & CreateCodeBody) | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (body.action === 'create_code') {
    const plainCode = typeof body.plainCode === 'string' ? body.plainCode.trim() : '';
    const credits = typeof body.credits === 'number' ? body.credits : Number(body.credits);
    if (!plainCode || !Number.isFinite(credits) || credits <= 0) {
      return NextResponse.json({ error: 'plainCode and credits required' }, { status: 400 });
    }
    const maxUses =
      body.maxUses == null ? 1 : Math.max(1, Math.floor(Number(body.maxUses) || 1));
    const expiresAt =
      typeof body.expiresAt === 'string' && body.expiresAt.trim()
        ? new Date(body.expiresAt)
        : null;
    try {
      const created = await createRedeemCode({
        plainCode,
        credits: Math.floor(credits),
        maxUses,
        expiresAt,
        note: typeof body.note === 'string' ? body.note : undefined,
      });
      return NextResponse.json({
        ok: true,
        redeemCode: { ...created, plainCode },
      });
    } catch (error) {
      console.error('[BILLING] create redeem code failed:', error);
      return NextResponse.json({ error: '创建 redeem code failed' }, { status: 500 });
    }
  }

  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
  }

  let userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId && typeof body.username === 'string' && body.username.trim()) {
    const user = await prismadb.user.findUnique({
      where: { username: body.username.trim().toLowerCase() },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, { status: 404 });
    }
    userId = user.id;
  }
  if (!userId) {
    return NextResponse.json({ error: 'userId or username required' }, { status: 400 });
  }

  try {
    const balance = await grantCredits({
      userId,
      amount: Math.floor(amount),
      reason: CREDIT_REASON.adminGrant,
      meta: typeof body.note === 'string' ? { note: body.note } : undefined,
    });
    return NextResponse.json({ ok: true, userId, balance, creditsAdded: Math.floor(amount) });
  } catch (error) {
    console.error('[BILLING] admin grant failed:', error);
    return NextResponse.json({ error: 'Grant failed' }, { status: 500 });
  }
}
