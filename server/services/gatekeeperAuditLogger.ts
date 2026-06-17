import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import type { GatekeeperIntent } from '@/app/api/generate-with-image/handlers/intentTypes';
import type { GatekeeperEvalResult } from '@/server/utils/gatekeeperEvaluator';

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

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'gatekeeper-audit.jsonl');

export async function logGatekeeperAudit(entry: GatekeeperAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);

  console.log(
    `[GATEKEEPER_AUDIT] passed=${entry.l1.passed} score=${entry.l1.score} type=${entry.requestType} complete=${entry.is_complete} issues=${entry.l1.issues.length}`,
    entry.l1.issues.length > 0 ? entry.l1.issues : ''
  );

  try {
    await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[GATEKEEPER_AUDIT] Failed to persist audit log:', error);
  }
}
