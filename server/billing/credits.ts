import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import {
  CREDIT_REASON,
  creditCostPerImage,
  creditSignupGrant,
  type CreditReason,
} from '@/server/config/credits';

export class InsufficientCreditsError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';
  constructor(message = '探索次数不足') {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

export class RedeemCodeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RedeemCodeError';
    this.code = code;
  }
}

export function hashRedeemCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function getCreditBalance(userId: string): Promise<number> {
  const user = await prismadb.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  });
  return user?.creditBalance ?? 0;
}

export async function resolveUserIdByClientId(clientId: string | undefined): Promise<string | null> {
  if (!clientId?.trim()) return null;
  const profile = await prismadb.clientProfile.findUnique({
    where: { id: clientId },
    select: { user: { select: { id: true } } },
  });
  return profile?.user?.id ?? null;
}

/** 注册赠送；已有 signup_grant 流水则跳过（防重复）。 */
export async function grantSignupCredits(userId: string): Promise<number> {
  const amount = creditSignupGrant();
  if (amount <= 0) return 0;

  return prismadb.$transaction(async (tx) => {
    const existing = await tx.creditLedger.findFirst({
      where: { userId, reason: CREDIT_REASON.signupGrant },
      select: { id: true },
    });
    if (existing) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { creditBalance: true },
      });
      return user?.creditBalance ?? 0;
    }

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
    });
    await tx.creditLedger.create({
      data: {
        userId,
        delta: amount,
        reason: CREDIT_REASON.signupGrant,
      },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user?.creditBalance ?? amount;
  });
}

export async function grantCredits(options: {
  userId: string;
  amount: number;
  reason: CreditReason;
  meta?: Prisma.InputJsonValue;
}): Promise<number> {
  const { userId, amount, reason, meta } = options;
  if (amount <= 0) throw new Error('grant amount must be positive');

  return prismadb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
    });
    await tx.creditLedger.create({
      data: { userId, delta: amount, reason, meta },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user?.creditBalance ?? 0;
  });
}

/**
 * 原子扣积分。余额不足抛 InsufficientCreditsError。
 * 使用条件 UPDATE，多实例下不会扣成负数。
 */
export async function debitCredits(options: {
  userId: string;
  amount: number;
  reason: CreditReason;
  messageId?: string;
  imageId?: string;
  meta?: Prisma.InputJsonValue;
}): Promise<number> {
  const { userId, amount, reason, messageId, imageId, meta } = options;
  if (amount <= 0) throw new Error('debit amount must be positive');

  return prismadb.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE "User"
      SET "creditBalance" = "creditBalance" - ${amount}
      WHERE id = ${userId} AND "creditBalance" >= ${amount}
    `;
    if (Number(updated) !== 1) {
      throw new InsufficientCreditsError();
    }
    await tx.creditLedger.create({
      data: {
        userId,
        delta: -amount,
        reason,
        messageId,
        imageId,
        meta,
      },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user?.creditBalance ?? 0;
  });
}

export async function debitImageGeneration(options: {
  userId: string;
  messageId?: string;
  imageId: string;
}): Promise<number> {
  return debitCredits({
    userId: options.userId,
    amount: creditCostPerImage(),
    reason: CREDIT_REASON.imageGen,
    messageId: options.messageId,
    imageId: options.imageId,
  });
}

/** 兑换码：锁码行 → 校验 → 加额 → 记流水 */
export async function redeemCreditCode(userId: string, rawCode: string): Promise<{
  balance: number;
  creditsAdded: number;
}> {
  const code = rawCode.trim();
  if (!code) {
    throw new RedeemCodeError('INVALID_CODE', '请输入兑换码');
  }
  const codeHash = hashRedeemCode(code);

  return prismadb.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        credits: number;
        maxUses: number;
        usedCount: number;
        expiresAt: Date | null;
      }>
    >`
      SELECT id, credits, "maxUses", "usedCount", "expiresAt"
      FROM "CreditRedeemCode"
      WHERE "codeHash" = ${codeHash}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new RedeemCodeError('INVALID_CODE', '兑换码无效');
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new RedeemCodeError('EXPIRED', '兑换码已过期');
    }
    if (row.usedCount >= row.maxUses) {
      throw new RedeemCodeError('EXHAUSTED', '兑换码已用完');
    }

    await tx.creditRedeemCode.update({
      where: { id: row.id },
      data: { usedCount: { increment: 1 } },
    });
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: row.credits } },
    });
    await tx.creditLedger.create({
      data: {
        userId,
        delta: row.credits,
        reason: CREDIT_REASON.redeem,
        meta: { codeHash, redeemCodeId: row.id },
      },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return { balance: user?.creditBalance ?? 0, creditsAdded: row.credits };
  });
}

export async function listCreditLedger(userId: string, limit = 50) {
  return prismadb.creditLedger.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  });
}

/** 创建兑换码（后台）。明文只返回一次。 */
export async function createRedeemCode(options: {
  plainCode: string;
  credits: number;
  maxUses?: number;
  expiresAt?: Date | null;
  note?: string;
}): Promise<{ id: string; codeHash: string; credits: number; maxUses: number }> {
  const credits = Math.floor(options.credits);
  if (credits <= 0) throw new Error('credits must be positive');
  const maxUses = Math.max(1, options.maxUses ?? 1);
  const codeHash = hashRedeemCode(options.plainCode);
  const created = await prismadb.creditRedeemCode.create({
    data: {
      codeHash,
      credits,
      maxUses,
      expiresAt: options.expiresAt ?? null,
      note: options.note,
    },
  });
  return {
    id: created.id,
    codeHash: created.codeHash,
    credits: created.credits,
    maxUses: created.maxUses,
  };
}
