import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Dev HMR 会复用 globalThis.prisma；schema/enum 变更后旧实例 DMMF 仍旧，写入新枚举会 ValidationError。
const PRISMA_CLIENT_REV = 'clothing-main-category-socks-20261112-pg';

declare global {
  var prisma: PrismaClient | undefined;
  var prismaClientRev: string | undefined;
  var prismaPgPool: Pool | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = globalThis.prismaPgPool ?? new Pool({ connectionString });
  if (process.env.NODE_ENV !== 'production') {
    globalThis.prismaPgPool = pool;
  }
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function isPrismaClientCurrent(client: PrismaClient): boolean {
  if (
    typeof (client as { savedOutfit?: { findMany?: unknown } }).savedOutfit?.findMany !==
    'function'
  ) {
    return false;
  }
  return globalThis.prismaClientRev === PRISMA_CLIENT_REV;
}

let prismadb: PrismaClient = globalThis.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production' && !isPrismaClientCurrent(prismadb)) {
  void prismadb.$disconnect().catch(() => undefined);
  prismadb = createPrismaClient();
}
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prismadb;
  globalThis.prismaClientRev = PRISMA_CLIENT_REV;
}
export default prismadb;
