import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRedeemCode,
  debitCredits,
  getCreditBalance,
  grantCredits,
  hashRedeemCode,
  InsufficientCreditsError,
  redeemCreditCode,
  RedeemCodeError,
} from '@/server/billing/credits';
import { CREDIT_REASON, creditCostPerImage, creditSignupGrant } from '@/server/config/credits';
import prismadb from '@/server/db';

describe('credits config', () => {
  it('defaults cost and signup grant', () => {
    assert.equal(creditCostPerImage(), 1);
    assert.equal(creditSignupGrant(), 5);
  });

  it('hashRedeemCode is case-insensitive and trimmed', () => {
    assert.equal(hashRedeemCode(' abc '), hashRedeemCode('ABC'));
    assert.notEqual(hashRedeemCode('ABC'), hashRedeemCode('ABD'));
  });
});

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

describe('credits debit / redeem concurrency', { skip: !hasDb }, () => {
  async function createTestUser(): Promise<string> {
    const username = `credit_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user = await prismadb.user.create({
      data: {
        username,
        passwordHash: 'test:not-a-real-hash',
      },
    });
    return user.id;
  }

  async function cleanupUser(userId: string) {
    await prismadb.user.delete({ where: { id: userId } }).catch(() => undefined);
  }

  it('debit refuses to go negative', async () => {
    const userId = await createTestUser();
    try {
      await grantCredits({ userId, amount: 1, reason: CREDIT_REASON.adminGrant });
      await debitCredits({
        userId,
        amount: 1,
        reason: CREDIT_REASON.imageGen,
        imageId: 'outfit_1',
      });
      await assert.rejects(
        () =>
          debitCredits({
            userId,
            amount: 1,
            reason: CREDIT_REASON.imageGen,
            imageId: 'outfit_2',
          }),
        (err: unknown) => err instanceof InsufficientCreditsError
      );
      assert.equal(await getCreditBalance(userId), 0);
    } finally {
      await cleanupUser(userId);
    }
  });

  it('parallel debits do not oversell balance', async () => {
    const userId = await createTestUser();
    try {
      await grantCredits({ userId, amount: 3, reason: CREDIT_REASON.adminGrant });
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          debitCredits({
            userId,
            amount: 1,
            reason: CREDIT_REASON.imageGen,
            imageId: `outfit_${i}`,
          })
        )
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      assert.equal(ok.length, 3);
      assert.equal(failed.length, 7);
      assert.ok(failed.every((r) => r.status === 'rejected' && r.reason instanceof InsufficientCreditsError));
      assert.equal(await getCreditBalance(userId), 0);

      const ledger = await prismadb.creditLedger.findMany({
        where: { userId, reason: CREDIT_REASON.imageGen },
      });
      assert.equal(ledger.length, 3);
    } finally {
      await cleanupUser(userId);
    }
  });

  it('redeem code cannot be oversold concurrently', async () => {
    const plainCode = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await createRedeemCode({
      plainCode,
      credits: 2,
      maxUses: 1,
      note: 'unit-test',
    });

    const userIds = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    try {
      const results = await Promise.allSettled(
        userIds.map((userId) => redeemCreditCode(userId, plainCode))
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      assert.equal(ok.length, 1);
      assert.equal(failed.length, 2);
      assert.ok(
        failed.every(
          (r) =>
            r.status === 'rejected' &&
            r.reason instanceof RedeemCodeError &&
            r.reason.code === 'EXHAUSTED'
        )
      );

      const code = await prismadb.creditRedeemCode.findUnique({ where: { id: created.id } });
      assert.equal(code?.usedCount, 1);

      const balances = await Promise.all(userIds.map((id) => getCreditBalance(id)));
      assert.equal(balances.filter((b) => b === 2).length, 1);
      assert.equal(balances.filter((b) => b === 0).length, 2);
    } finally {
      await Promise.all(userIds.map(cleanupUser));
      await prismadb.creditRedeemCode.delete({ where: { id: created.id } }).catch(() => undefined);
    }
  });
});
