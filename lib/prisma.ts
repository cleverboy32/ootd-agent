import { PrismaClient } from '@prisma/client';
import { neon } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';

// 声明一个全局变量来缓存 PrismaClient
declare global {
  var prisma: PrismaClient | undefined;
}

const neonConnection = neon(process.env.DATABASE_URL!);
const adapter = new PrismaNeon(neonConnection);

// 在开发环境中，使用全局变量来防止热重载时创建新的 PrismaClient 实例
// 在生产环境中，每次都创建一个新的实例
const prismadb = globalThis.prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prismadb;

export default prismadb;