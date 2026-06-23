import path from 'path';

/** Runtime audit log directory (gitignored). */
export const LOG_DIR = path.join(process.cwd(), 'log');

export function auditLogPath(fileName: string): string {
  return path.join(LOG_DIR, fileName);
}
