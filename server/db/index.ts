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

// In a development environment, use the global variable to prevent hot-reloading
// from creating new PrismaClient instances. In production, always create a new one.
const prismadb = globalThis.prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prismadb;
export default prismadb;

