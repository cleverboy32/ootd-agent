import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';
import {
  buildStylistSelectionAudit,
  type StylistSelectionAuditInput,
} from '@/server/utils/stylistSelectionAudit';

export type StylistSelectionLogEntry = ReturnType<typeof buildStylistSelectionAudit>;

export interface StylistSkillsAuditEntry {
  timestamp: string;
  conversationId?: string;
  messageId?: string;
  userMessage: string;
  requestType: string;
  occasion: string;
  weather: string;
  stylePreference: string;
  specialRequests: string;
  rawSkillNames: string[];
  skillNames: string[];
  failed?: boolean;
  error?: string;
}

const AUDIT_LOG_PATH = auditLogPath('stylist-selection.jsonl');
const SKILLS_AUDIT_LOG_PATH = auditLogPath('stylist-skills-audit.jsonl');

export async function logStylistSelection(entry: StylistSelectionLogEntry): Promise<void> {
  const { summary } = entry;
  console.log(
    `[STYLIST_SELECTION] wardrobe=${summary.wardrobePickCount} new_item=${summary.newItemCount}` +
      ` top1=${summary.inTop1Count} top3=${summary.inTop3Count}` +
      ` offList=${summary.offListCount} weakHardPick=${summary.weakOrNoneHardPickCount}`
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'STYLIST_SELECTION');
}

/** 选搭配 skill 落盘，避免终端滚动冲掉。 */
export async function logStylistSkillsAudit(entry: StylistSkillsAuditEntry): Promise<void> {
  const label = entry.failed
    ? '(failed)'
    : entry.skillNames.length > 0
      ? entry.skillNames.join(' | ')
      : '(none)';
  console.log(`[STYLIST_AGENT] Selected skills: ${label}`);
  await appendJsonlEntry(SKILLS_AUDIT_LOG_PATH, entry, 'STYLIST_SKILLS_AUDIT');
}

export function buildAndLogStylistSelection(input: StylistSelectionAuditInput): void {
  const entry = buildStylistSelectionAudit(input);
  void logStylistSelection(entry);
}

export { buildStylistSelectionAudit };
export type { StylistSelectionAuditInput, StylistSelectionSlotSnapshot } from '@/server/utils/stylistSelectionAudit';
