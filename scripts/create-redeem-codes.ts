/**
 * 批量创建积分兑换码。明文只在本脚本 stdout 打印一次。
 *
 * 用法：
 *   dotenv -e .env -e .env.local -- tsx scripts/create-redeem-codes.ts
 *   dotenv -e .env -e .env.local -- tsx scripts/create-redeem-codes.ts --count=20 --credits=5
 */
import { randomBytes } from 'node:crypto';
import { createRedeemCode } from '@/server/billing/credits';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function generatePlainCode(): string {
  const raw = randomBytes(6).toString('hex').toUpperCase();
  return `OOTD-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function main(): Promise<void> {
  const count = Math.max(1, Math.floor(Number(readArg('count') ?? 20)));
  const credits = Math.max(1, Math.floor(Number(readArg('credits') ?? 5)));
  const maxUses = Math.max(1, Math.floor(Number(readArg('maxUses') ?? 1)));
  const note = readArg('note') ?? `batch-${new Date().toISOString().slice(0, 10)}`;

  console.log(`Creating ${count} redeem codes × ${credits} credits (maxUses=${maxUses})…`);
  console.log('plainCode\tid\tcredits\tmaxUses');

  for (let i = 0; i < count; i += 1) {
    const plainCode = generatePlainCode();
    const created = await createRedeemCode({ plainCode, credits, maxUses, note });
    console.log(`${plainCode}\t${created.id}\t${created.credits}\t${created.maxUses}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
