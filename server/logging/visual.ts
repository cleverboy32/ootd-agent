import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

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

const AUDIT_LOG_PATH = auditLogPath('visual-audit.jsonl');

export async function logVisualAudit(entry: VisualAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);
  console.log('[VISUAL_AUDIT_LOG]', line);
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'VISUAL_AUDIT_LOG');
}
