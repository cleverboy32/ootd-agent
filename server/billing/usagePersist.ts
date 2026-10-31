import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import type { UsageAuditEntry } from '@/server/logging/modelUsage';
import type { RequestUsageSummary } from '@/server/logging/request';

/** 单次模型调用写入 UsageEvent；失败不抛。 */
export async function persistUsageEvent(
  entry: UsageAuditEntry,
  userId?: string | null
): Promise<void> {
  try {
    await prismadb.usageEvent.create({
      data: {
        userId: userId || undefined,
        clientId: entry.clientId,
        conversationId: entry.conversationId,
        messageId: entry.messageId,
        model: entry.model,
        kind: entry.kind,
        cacheHitTokens: entry.cacheHitTokens,
        cacheMissTokens: entry.cacheMissTokens,
        completionTokens: entry.completionTokens,
        embeddingTokens: entry.embeddingTokens,
        generatedImages: entry.generatedImages,
        costCny:
          entry.costCny == null ? undefined : new Prisma.Decimal(entry.costCny),
        rateId: entry.rateId,
      },
    });
  } catch (error) {
    console.error('[USAGE_DB] Failed to persist UsageEvent:', error);
  }
}

/** 按消息 upsert 花费汇总。 */
export async function persistUsageMessageRollup(options: {
  messageId: string;
  userId?: string | null;
  conversationId?: string;
  usage: RequestUsageSummary;
  durationMs?: number;
}): Promise<void> {
  const { messageId, userId, conversationId, usage, durationMs } = options;
  if (!messageId) return;
  try {
    const priced = new Prisma.Decimal(usage.pricedCostCny ?? 0);
    await prismadb.usageMessageRollup.upsert({
      where: { messageId },
      create: {
        messageId,
        userId: userId || undefined,
        conversationId,
        calls: usage.calls,
        cacheHitTokens: usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens,
        completionTokens: usage.completionTokens,
        embeddingTokens: usage.embeddingTokens,
        generatedImages: usage.generatedImages,
        pricedCostCny: priced,
        unpricedCalls: usage.unpricedCalls,
        durationMs,
      },
      update: {
        userId: userId || undefined,
        conversationId,
        calls: usage.calls,
        cacheHitTokens: usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens,
        completionTokens: usage.completionTokens,
        embeddingTokens: usage.embeddingTokens,
        generatedImages: usage.generatedImages,
        pricedCostCny: priced,
        unpricedCalls: usage.unpricedCalls,
        durationMs,
      },
    });
  } catch (error) {
    console.error('[USAGE_DB] Failed to persist UsageMessageRollup:', error);
  }
}
