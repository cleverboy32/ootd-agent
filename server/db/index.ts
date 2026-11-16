import { PrismaClient } from '@prisma/client';
import { neon } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';

// Dev HMR 会复用 globalThis.prisma；schema/enum 变更后旧实例 DMMF 仍旧，写入新枚举会 ValidationError。
const PRISMA_CLIENT_REV = 'clothing-main-category-socks-20261112';

declare global {
  var prisma: PrismaClient | undefined;
  var prismaClientRev: string | undefined;
}

const neonConnection = neon(process.env.DATABASE_URL!);

// The original code was correct at runtime. The TypeScript error is due to
// a type mismatch between library versions. We use `as any` to bridge this gap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaNeon(neonConnection as any);

function createPrismaClient(): PrismaClient {
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

