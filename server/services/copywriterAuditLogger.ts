import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import type { CopywriterEvalResult } from '@/server/utils/copywriterEvaluator';

export interface CopywriterAuditLogEntry {
  timestamp: string;
  conversationId?: string;
  messageId?: string;
  personalStyle?: string;
  outfitCount: number;
  copywriterTextLength: number;
  l1: CopywriterEvalResult;
  copywriterText: string;
}

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'copywriter-audit.jsonl');

export async function logCopywriterAudit(entry: CopywriterAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);

  console.log(
    `[COPYWRITER_AUDIT] passed=${entry.l1.passed} score=${entry.l1.score} issues=${entry.l1.issues.length}`,
    entry.l1.issues.length > 0 ? entry.l1.issues : ''
  );

  try {
    await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[COPYWRITER_AUDIT] Failed to persist audit log:', error);
  }
}
