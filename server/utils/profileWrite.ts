import type { Prisma } from '@prisma/client';
import prismadb from '@/server/db';

function asProfileRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export type ProfileWriteResult =
  | { status: 'missing' }
  | { status: 'unchanged'; profileData: Record<string, unknown> }
  | { status: 'updated'; profileData: Record<string, unknown> };

/**
 * 在同一事务里锁住用户行，读出 profileData，合并后再写回。
 * 单独的 UPDATE 只会锁住写那一下；锁不到「先读出整份 JSON」和「写回」之间的空档。
 * merge 返回 null 表示不写。
 */
export async function updateUserProfileData(
  userId: string,
  merge: (current: Record<string, unknown>) => Record<string, unknown> | null
): Promise<ProfileWriteResult> {
  return prismadb.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ profileData: Prisma.JsonValue }>>`
      SELECT "profileData" FROM "User" WHERE id = ${userId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return { status: 'missing' };

    const current = asProfileRecord(row.profileData);
    const next = merge(current);
    if (!next) return { status: 'unchanged', profileData: current };

    await tx.user.update({
      where: { id: userId },
      data: { profileData: next as Prisma.InputJsonValue },
    });
    return { status: 'updated', profileData: next };
  });
}
