/**
 * 探索次数 / 积分 API 客户端
 */
import { withBasePath } from '@/lib/utils';

export interface CreditLedgerItem {
  id: string;
  delta: number;
  reason: string;
  reasonLabel: string;
  messageId: string | null;
  imageId: string | null;
  createdAt: string;
}

export interface CreditsResponse {
  balance: number;
  ledger: CreditLedgerItem[];
  hasMore: boolean;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCredits(
  limit = 20,
  offset = 0
): Promise<CreditsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(withBasePath(`/api/billing/credits?${params}`), {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  return parseOrThrow<CreditsResponse>(res);
}

export async function redeemCode(code: string): Promise<{ balance: number; creditsAdded: number }> {
  const res = await fetch(withBasePath('/api/billing/redeem'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ code }),
  });
  return parseOrThrow(res);
}
