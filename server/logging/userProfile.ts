import type { UserProfileResult } from '@/server/agents/user-profile';
import type { UserProfileEvalResult } from '@/server/utils/userProfileEvaluator';
import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

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

const AUDIT_LOG_PATH = auditLogPath('user-profile-audit.jsonl');

export async function logUserProfileAudit(entry: UserProfileAuditLogEntry): Promise<void> {
  console.log(
    `[USER_PROFILE_AUDIT] passed=${entry.l1.passed} score=${entry.l1.score} prefs=${entry.l1.stats.resultPreferenceCount} issues=${entry.l1.issues.length}`,
    entry.l1.issues.length > 0 ? entry.l1.issues : ''
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'USER_PROFILE_AUDIT');
}
