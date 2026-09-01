import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

/** Prisma CLI migrations prefer unpooled/direct Neon URLs when available. */
function resolveMigrationDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    env('DATABASE_URL')
  );
}

export default defineConfig({
  datasource: {
    url: resolveMigrationDatabaseUrl(),
  },
});