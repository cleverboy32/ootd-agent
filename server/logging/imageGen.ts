import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

export interface ImageGenAuditLogEntry {
  timestamp: string;
  outfitId: string;
  messageId?: string;
  attempt: number;
  mode: 'multimodal' | 'text-only';
  success: boolean;
  error?: string;
  trigger: 'initial' | 'user_retry';
}

const AUDIT_LOG_PATH = auditLogPath('image-gen-audit.jsonl');

export async function logImageGenAudit(entry: ImageGenAuditLogEntry): Promise<void> {
  console.log(
    `[IMAGE_GEN_AUDIT] trigger=${entry.trigger} outfit=${entry.outfitId} attempt=${entry.attempt} success=${entry.success}`
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'IMAGE_GEN_AUDIT');
}
