import type { CopywriterEvalResult } from '@/server/utils/copywriterEvaluator';
import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

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

const AUDIT_LOG_PATH = auditLogPath('copywriter-audit.jsonl');

export async function logCopywriterAudit(entry: CopywriterAuditLogEntry): Promise<void> {
  console.log(
    `[COPYWRITER_AUDIT] passed=${entry.l1.passed} score=${entry.l1.score} issues=${entry.l1.issues.length}`,
    entry.l1.issues.length > 0 ? entry.l1.issues : ''
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'COPYWRITER_AUDIT');
}
