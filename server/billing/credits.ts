/**
 * 积分账本与兑换。
 *
 * 并发策略（本文件仅有的「锁」相关逻辑）：
 * - 扣费 debitCredits：条件 UPDATE（余额够才改），无行锁，靠 affected rows 判成败
 * - 兑换 redeemCreditCode：对 CreditRedeemCode 行 SELECT FOR UPDATE，串行化同一码的并发兑换
 * - 赠送 grant*：事务 + increment；signup 另用流水去重，无 FOR UPDATE
 */
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

/** 身份已是 userId。确认用户仍存在后返回 id。 */
export async function resolveUserIdByClientId(userId: string | undefined): Promise<string | null> {
  if (!userId?.trim()) return null;
  const user = await prismadb.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * 注册赠送。
 * 用 ledger 是否已有 signup_grant 做幂等（非行锁）；极端双开注册仍可能竞态，可接受。
 */
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

    // Postgres increment 单语句原子，无需 FOR UPDATE
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

/** 通用加额：事务内 increment + 记流水。无行锁。 */
export async function grantCredits(options: {
  userId: string;
  amount: number;
  reason: CreditReason;
  meta?: Prisma.InputJsonValue;
}): Promise<number> {
  const { userId, amount, reason, meta } = options;
  if (amount <= 0) throw new Error('grant amount must be positive');

  return prismadb.$transaction(async (tx) => {

    // 增加积分余额
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
    });

    // 记录流水
    await tx.creditLedger.create({
      data: { userId, delta: amount, reason, meta },
    });

    // 获取更新后的积分余额
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user?.creditBalance ?? 0;
  });
}

/**
 * 原子扣积分。余额不足抛 InsufficientCreditsError。
 *
 * 不用 SELECT FOR UPDATE：一条条件 UPDATE 同时完成「读余额 + 扣减」。
 * WHERE creditBalance >= amount 保证多实例并发也不会扣成负数；
 * affected rows !== 1 即视为余额不足（含用户不存在）。
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
    //  UPDATE 锁
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

/**
 * 兑换码。
 *
 * 流程：事务内 FOR UPDATE 锁码行 → 校验过期/次数 → usedCount++ → 用户加额 → 记流水。
 * 必须先锁码行：否则两请求同时读到 usedCount < maxUses 会超兑。
 * 用户余额用 increment（单语句原子）；码侧靠行锁串行。
 */
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
    // 行锁：同码并发兑换会在此排队，直到本事务提交/回滚
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
