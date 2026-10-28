import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

export interface StylistOutfitCriticNote {
  id: string;
  ok: boolean;
  note: string;
}

export interface StylistOutfitAuditEntry {
  timestamp: string;
  conversationId?: string;
  messageId?: string;
  userMessage?: string;
  occasion?: string;
  specialRequests?: string;
  stylePreference?: string;
  skillNames?: string[];
  outfitCount: number;
  approved: boolean;
  reason: string;
  outfitNotes?: StylistOutfitCriticNote[];
  failed?: boolean;
  error?: string;
}

const AUDIT_LOG_PATH = auditLogPath('stylist-outfit-audit.jsonl');

export async function logStylistOutfitAudit(entry: StylistOutfitAuditEntry): Promise<void> {
  const label = entry.failed
    ? `failed ${entry.error ?? ''}`
    : `approved=${entry.approved} outfits=${entry.outfitCount} ${entry.reason ?? ''}`.trim();
  console.log(`[STYLIST_OUTFIT_CRITIC] ${label}`);
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'STYLIST_OUTFIT_AUDIT');
}
