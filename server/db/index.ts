import { PrismaClient } from '@prisma/client';
import { neon } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';

// Declare a global variable to cache the PrismaClient instance
declare global {
  var prisma: PrismaClient | undefined;
}

const neonConnection = neon(process.env.DATABASE_URL!);

// The original code was correct at runtime. The TypeScript error is due to
// a type mismatch between library versions. We use `as any` to bridge this gap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaNeon(neonConnection as any);

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter });
}

// Dev HMR 会复用 globalThis.prisma；schema 新增 model 后旧实例没有对应 delegate，需重建。
let prismadb = globalThis.prisma ?? createPrismaClient();
if (
  process.env.NODE_ENV !== 'production' &&
  typeof (prismadb as { savedOutfit?: { findMany?: unknown } }).savedOutfit?.findMany !==
    'function'
) {
  void prismadb.$disconnect().catch(() => undefined);
  prismadb = createPrismaClient();
}
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prismadb;
export default prismadb;

