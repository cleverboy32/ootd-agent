import type { GatekeeperIntent } from '@/server/agents/intent';
import type { GatekeeperEvalResult } from '@/server/utils/gatekeeperEvaluator';
import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

export interface GatekeeperAuditLogEntry {
  timestamp: string;
  conversationId?: string;
  messageId?: string;
  contextTextLength: number;
  requestType: string;
  is_complete: boolean;
  gatekeeper_reply?: string;
  followup_questions: string[];
  extracted_intent: GatekeeperIntent;
  weather_lookup?: { needed: boolean; city: string };
  wardrobe_candidates?: unknown[];
  l1: GatekeeperEvalResult;
}

const AUDIT_LOG_PATH = auditLogPath('gatekeeper-audit.jsonl');

export async function logGatekeeperAudit(entry: GatekeeperAuditLogEntry): Promise<void> {
  console.log(
    `[GATEKEEPER_AUDIT] passed=${entry.l1.passed} score=${entry.l1.score} type=${entry.requestType} complete=${entry.is_complete} issues=${entry.l1.issues.length}`,
    entry.l1.issues.length > 0 ? entry.l1.issues : ''
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'GATEKEEPER_AUDIT');
}
