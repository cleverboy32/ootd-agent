import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export interface VisualAuditLogEntry {
  timestamp: string;
  outfitId: string;
  imageId: string;
  imageUrl: string;
  overallConcept: string;
  approved: boolean | null;
  critiqueReason: string;
  revisedPromptEnhancement: string;
  auditError?: string;
}

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'visual-audit.jsonl');

export async function logVisualAudit(entry: VisualAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);

  console.log('[VISUAL_AUDIT_LOG]', line);

  try {
    await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[VISUAL_AUDIT_LOG] Failed to persist audit log:', error);
  }
}
