import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';
import {
  buildStylistSelectionAudit,
  type StylistSelectionAuditInput,
} from '@/server/utils/stylistSelectionAudit';

export type StylistSelectionLogEntry = ReturnType<typeof buildStylistSelectionAudit>;

const AUDIT_LOG_PATH = auditLogPath('stylist-selection.jsonl');

export async function logStylistSelection(entry: StylistSelectionLogEntry): Promise<void> {
  const { summary } = entry;
  console.log(
    `[STYLIST_SELECTION] wardrobe=${summary.wardrobePickCount} new_item=${summary.newItemCount}` +
      ` top1=${summary.inTop1Count} top3=${summary.inTop3Count}` +
      ` offList=${summary.offListCount} weakHardPick=${summary.weakOrNoneHardPickCount}`
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'STYLIST_SELECTION');
}

export function buildAndLogStylistSelection(input: StylistSelectionAuditInput): void {
  const entry = buildStylistSelectionAudit(input);
  void logStylistSelection(entry);
}

export { buildStylistSelectionAudit };
export type { StylistSelectionAuditInput, StylistSelectionSlotSnapshot } from '@/server/utils/stylistSelectionAudit';
