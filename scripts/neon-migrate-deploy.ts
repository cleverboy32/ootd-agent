/**
 * Apply pending Prisma SQL migrations via Neon HTTP driver.
 *
 * Use when `prisma migrate deploy` fails with P1001 but the app DB (Neon serverless) works.
 *
 * Usage:
 *   pnpm db:migrate:neon
 */
import { config as loadEnv } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

loadEnv({ path: path.join(process.cwd(), '.env') });
loadEnv({ path: path.join(process.cwd(), '.env.local'), override: true });

const MIGRATIONS_DIR = path.join(process.cwd(), 'server/db/migrations');

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function splitSqlStatements(sqlText: string): string[] {
  return sqlText
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function listMigrationFolders(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const sql = neon(databaseUrl);
  const folders = await listMigrationFolders();
  const appliedRows = (await sql`
    SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL
  `) as Array<{ migration_name: string }>;
  const applied = new Set(appliedRows.map((row) => row.migration_name));

  const pending = folders.filter((folder) => !applied.has(folder));
  if (pending.length === 0) {
    console.log('[NEON_MIGRATE] No pending migrations.');
    return;
  }

  console.log(`[NEON_MIGRATE] Pending migrations: ${pending.join(', ')}`);

  for (const folder of pending) {
    const migrationPath = path.join(MIGRATIONS_DIR, folder, 'migration.sql');
    const migrationSql = await fs.readFile(migrationPath, 'utf8');
    const checksum = sha256(migrationSql);
    const startedAt = new Date();

    console.log(`[NEON_MIGRATE] Applying ${folder}...`);

    for (const statement of splitSqlStatements(migrationSql)) {
      await sql.query(statement);
    }

    await sql`
      INSERT INTO "_prisma_migrations" (
        id,
        checksum,
        finished_at,
        migration_name,
        logs,
        rolled_back_at,
        started_at,
        applied_steps_count
      ) VALUES (
        ${randomUUID()},
        ${checksum},
        ${new Date()},
        ${folder},
        NULL,
        NULL,
        ${startedAt},
        1
      )
    `;

    console.log(`[NEON_MIGRATE] Applied ${folder}`);
  }

  console.log('[NEON_MIGRATE] Done.');
  console.log('[NEON_MIGRATE] Regenerating Prisma client...');
  execSync('pnpm db:generate', { stdio: 'inherit', cwd: process.cwd() });
}

main().catch((error: unknown) => {
  console.error('[NEON_MIGRATE] Failed:', error);
  process.exitCode = 1;
});
