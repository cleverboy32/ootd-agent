import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

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

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'image-gen-audit.jsonl');

export async function logImageGenAudit(entry: ImageGenAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);
  console.log(
    `[IMAGE_GEN_AUDIT] trigger=${entry.trigger} outfit=${entry.outfitId} attempt=${entry.attempt} success=${entry.success}`
  );

  try {
    await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[IMAGE_GEN_AUDIT] Failed to persist audit log:', error);
  }
}
