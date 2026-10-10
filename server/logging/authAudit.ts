import { appendJsonlEntry } from './jsonl';
import { auditLogPath } from './paths';

export type AuthAuditAction =
  | 'register'
  | 'login'
  | 'logout'
  | 'change_password'
  | 'reset_password'
  | 'set_security_questions'
  | 'generate_recovery_codes';

export interface AuthAuditEntry {
  timestamp: string;
  action: AuthAuditAction;
  outcome: 'success' | 'failure';
  username?: string;
  userId?: string;
  reason?: string;
}

const AUTH_AUDIT_LOG_PATH = auditLogPath('auth-audit.jsonl');

/** 认证事件审计：终端可见 + log/auth-audit.jsonl 落盘 */
export async function logAuthEvent(entry: Omit<AuthAuditEntry, 'timestamp'>): Promise<void> {
  const full: AuthAuditEntry = { timestamp: new Date().toISOString(), ...entry };
  console.log(
    `[AUTH_AUDIT] action=${full.action} outcome=${full.outcome} ` +
      `username=${full.username ?? '-'} reason=${full.reason ?? '-'}`
  );
  await appendJsonlEntry(AUTH_AUDIT_LOG_PATH, full, 'AUTH_AUDIT');
}
