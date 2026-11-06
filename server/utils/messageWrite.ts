import type { Prisma } from '@prisma/client';
import prismadb from '@/server/db';

/**
 * 锁住消息行，用当前 content 做合并再写回。
 * 出图耗时留在事务外；两路重试同时写时，后拿到锁的会看到先写入的那张图。
 * merge 返回 null 表示不写。
 */
export async function updateMessageContent(
  messageId: string,
  merge: (current: unknown) => unknown | null
): Promise<'missing' | 'unchanged' | 'updated'> {
  return prismadb.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ content: Prisma.JsonValue }>>`
      SELECT "content" FROM "Message" WHERE id = ${messageId} FOR UPDATE
    `;
    if (!rows[0]) return 'missing';

    const next = merge(rows[0].content);
    if (next == null) return 'unchanged';

    await tx.message.update({
      where: { id: messageId },
      data: { content: next as Prisma.InputJsonValue },
    });
    return 'updated';
  });
}
