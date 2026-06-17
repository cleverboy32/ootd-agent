import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import type { UserProfileResult } from '@/app/api/generate-with-image/handlers/userProfileAgent';
import type { UserProfileEvalResult } from '@/server/utils/userProfileEvaluator';

export interface UserProfileAuditLogEntry {
  timestamp: string;
  conversationId?: string;
  messageId?: string;
  userMessage?: string;
  contextTextLength: number;
  hadPreviousProfile: boolean;
  profile: UserProfileResult;
  previousProfileSnapshot?: {
    height: string;
    weight: string;
    name: string;
    preferenceCount: number;
    personal_style: string;
    hasVisualData: boolean;
  };
  l1: UserProfileEvalResult;
}

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'user-profile-audit.jsonl');

export async function logUserProfileAudit(entry: UserProfileAuditLogEntry): Promise<void> {
  const line = JSON.stringify(entry);

  console.log(
    `[USER_PROFILE_AUDIT] passed=${entry.l1.passed} score=${entry.l1.score} prefs=${entry.l1.stats.resultPreferenceCount} issues=${entry.l1.issues.length}`,
    entry.l1.issues.length > 0 ? entry.l1.issues : ''
  );

  try {
    await mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[USER_PROFILE_AUDIT] Failed to persist audit log:', error);
  }
}
