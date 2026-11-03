import { withBasePath } from '@/lib/utils';

export const AUTH_BOOT_KEY = 'ootd-auth-boot';

export function readAuthBootLabel(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(AUTH_BOOT_KEY);
    if (!raw) return null;
    if (raw === '1') return '正在进入…';
    return raw;
  } catch {
    return null;
  }
}

/** 仅在登录/退出跳转时打标；刷新后由轻量条承接，避免每次进站全屏挡页面 */
export function beginAuthBoot(label = '正在进入…'): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(AUTH_BOOT_KEY, label);
  } catch {
    /* private mode */
  }
}

export function clearAuthBoot(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(AUTH_BOOT_KEY);
  } catch {
    /* ignore */
  }
}

export function navigateWithAuthBoot(targetPath: string, label = '正在进入…'): void {
  beginAuthBoot(label);
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const normalizedTarget = targetPath.replace(/\/+$/, '') || '/';
  if (currentPath === normalizedTarget) {
    window.location.reload();
    return;
  }
  window.location.assign(targetPath.startsWith('/') ? targetPath : withBasePath(targetPath));
}
