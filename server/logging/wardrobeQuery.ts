import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

export type WardrobeQueryLogKind = 'queries' | 'query_critic' | 'weather_query_guard';

export interface WardrobeQueryAuditEntry {
  timestamp: string;
  kind: WardrobeQueryLogKind;
  conversationId?: string;
  messageId?: string;
  userMessage?: string;
  occasion?: string;
  specialRequests?: string;
  stylePreference?: string;
  skillNames?: string[];
  queries: Array<{ slot?: string; query: string; outfitId?: string; target?: string }>;
  /** Plan 骨架摘要（concept + slots） */
  planOutfits?: Array<{
    id: string;
    overall_concept: string;
    slots: Array<{ slot: string; target: string; search_query: string; allow_new: boolean }>;
  }>;
  approved?: boolean;
  reason?: string;
  failed?: boolean;
  error?: string;
  /** weather_query_guard: before → after */
  changes?: Array<{ slot: string; from: string; to: string; reason: string }>;
}

const AUDIT_LOG_PATH = auditLogPath('wardrobe-query-audit.jsonl');

export async function logWardrobeQueryAudit(entry: WardrobeQueryAuditEntry): Promise<void> {
  if (entry.kind === 'queries') {
    const preview = entry.queries.map((item) => `${item.slot ?? '?'}:${item.query}`).join(' | ');
    console.log(`[WARDROBE_QUERY] slots=${entry.queries.length} ${preview}`);
  } else if (entry.kind === 'weather_query_guard') {
    const n = entry.changes?.length ?? 0;
    const preview = (entry.changes ?? [])
      .map((c) => `${c.slot}:${c.from}→${c.to || '(drop)'}`)
      .join(' | ');
    console.log(`[WARDROBE_QUERY_GUARD] changes=${n} ${preview}`);
  } else {
    const label = entry.failed
      ? `failed ${entry.error ?? ''}`
      : `approved=${entry.approved} ${entry.reason ?? ''}`.trim();
    console.log(`[WARDROBE_QUERY_CRITIC] ${label}`);
  }
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'WARDROBE_QUERY_AUDIT');
}
