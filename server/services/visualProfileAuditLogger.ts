import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export interface VisualProfileAuditLogEntry {
  timestamp: string;
  clientId: string;
  imageUrl: string;
  durationMs: number;
  success: boolean;
  error?: string;
  result?: {
    skin_tone: string;
    body_shape: string;
    hair_color: string;
  };
}

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'visual-profile-audit.jsonl');

export async function logVisualProfileAudit(entry: VisualProfileAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);

  console.log(
    `[VISUAL_PROFILE_AUDIT] success=${entry.success} clientId=${entry.clientId} durationMs=${entry.durationMs}`,
    entry.error ?? ''
  );

  try {
    await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[VISUAL_PROFILE_AUDIT] Failed to persist audit log:', error);
  }
}
