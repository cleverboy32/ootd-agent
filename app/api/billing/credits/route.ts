import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/currentUser';
import { getCreditBalance, listCreditLedger } from '@/server/billing/credits';
import { CREDIT_REASON_LABELS } from '@/server/config/credits';

/** GET /api/billing/credits — 余额 + 积分流水（不含 ¥/token） */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  const [balance, ledger] = await Promise.all([
    getCreditBalance(user.id),
    listCreditLedger(user.id, limit),
  ]);

  return NextResponse.json({
    balance,
    ledger: ledger.map((row) => ({
      id: row.id,
      delta: row.delta,
      reason: row.reason,
      reasonLabel: CREDIT_REASON_LABELS[row.reason] ?? row.reason,
      messageId: row.messageId,
      imageId: row.imageId,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
