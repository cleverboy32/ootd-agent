import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/currentUser';
import { RedeemCodeError, redeemCreditCode } from '@/server/billing/credits';

interface RedeemBody {
  code?: unknown;
}

/** POST /api/billing/redeem — 兑换码加次 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as RedeemBody | null;
  const code = typeof body?.code === 'string' ? body.code : '';

  try {
    const result = await redeemCreditCode(user.id, code);
    return NextResponse.json({
      balance: result.balance,
      creditsAdded: result.creditsAdded,
    });
  } catch (error) {
    if (error instanceof RedeemCodeError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
    console.error('[BILLING] redeem failed:', error);
    return NextResponse.json({ error: '兑换失败，请稍后重试' }, { status: 500 });
  }
}
