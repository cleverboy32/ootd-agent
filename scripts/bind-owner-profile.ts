/**
 * 一次性迁移：把既有单用户数据（ClientProfile.id = OWNER_CLIENT_ID）绑定到指定账号。
 *
 * 用法：
 *   pnpm auth:bind-owner -- --user <username> [--force]
 *
 * 安全性质：
 * - 幂等：已绑定则直接报告退出
 * - 既有 profile 已绑定其他账号时拒绝覆盖
 * - 账号当前 profile 非空时需 --force 确认（其数据将被删除）
 */
import prismadb from '@/server/db';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const userIndex = args.indexOf('--user');
  const username = userIndex >= 0 ? args[userIndex + 1]?.trim().toLowerCase() : '';
  const force = args.includes('--force');

  if (!username) {
    console.error('用法: pnpm auth:bind-owner -- --user <username> [--force]');
    process.exit(1);
  }

  const ownerProfileId = process.env.OWNER_CLIENT_ID?.trim();
  if (!ownerProfileId) {
    console.error('[BIND] OWNER_CLIENT_ID 未配置');
    process.exit(1);
  }

  const user = await prismadb.user.findUnique({
    where: { username },
    include: {
      clientProfile: {
        include: { _count: { select: { conversations: true, clothingItems: true } } },
      },
    },
  });
  if (!user) {
    console.error(`[BIND] 用户不存在: ${username}（请先注册）`);
    process.exit(1);
  }

  if (user.clientProfileId === ownerProfileId) {
    console.log(`[BIND] 已绑定：${username} → ${ownerProfileId}，无需操作`);
    return;
  }

  const ownerProfile = await prismadb.clientProfile.findUnique({
    where: { id: ownerProfileId },
    include: { user: true, _count: { select: { conversations: true, clothingItems: true } } },
  });
  if (!ownerProfile) {
    console.error(`[BIND] 既有数据 profile 不存在: ${ownerProfileId}`);
    process.exit(1);
  }
  if (ownerProfile.user) {
    console.error(`[BIND] 既有数据已绑定到账号 ${ownerProfile.user.username}，拒绝覆盖`);
    process.exit(1);
  }

  const current = user.clientProfile._count;
  if ((current.conversations > 0 || current.clothingItems > 0) && !force) {
    console.error(
      `[BIND] 账号 ${username} 当前 profile 非空（会话 ${current.conversations}、衣物 ${current.clothingItems}）。` +
        '确认放弃这些数据请加 --force'
    );
    process.exit(1);
  }

  const orphanProfileId = user.clientProfileId;
  await prismadb.$transaction([
    prismadb.user.update({
      where: { id: user.id },
      data: { clientProfileId: ownerProfileId },
    }),
    prismadb.clientProfile.delete({ where: { id: orphanProfileId } }),
  ]);

  console.log(`[BIND] 绑定完成：${username} → ${ownerProfileId}`);
  console.log(
    `[BIND] 既有数据：会话 ${ownerProfile._count.conversations}、衣物 ${ownerProfile._count.clothingItems}`
  );
  console.log(`[BIND] 已清理注册时自动创建的空 profile：${orphanProfileId}`);
}

main()
  .catch((error: unknown) => {
    console.error('[BIND] 迁移失败:', error);
    process.exitCode = 1;
  })
  .finally(() => prismadb.$disconnect());
