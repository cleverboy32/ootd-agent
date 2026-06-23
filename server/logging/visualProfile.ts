import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

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

const AUDIT_LOG_PATH = auditLogPath('visual-profile-audit.jsonl');

export async function logVisualProfileAudit(entry: VisualProfileAuditLogEntry): Promise<void> {
  console.log(
    `[VISUAL_PROFILE_AUDIT] success=${entry.success} clientId=${entry.clientId} durationMs=${entry.durationMs}`,
    entry.error ?? ''
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'VISUAL_PROFILE_AUDIT');
}
