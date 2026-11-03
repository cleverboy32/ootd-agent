/** 未登录可停留的页面路径（已 stripBasePath） */
export function isGuestAllowedPath(path: string): boolean {
  const normalized = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (normalized === '/') return true;
  if (normalized === '/login' || normalized.startsWith('/login/')) return true;
  return false;
}

/** 站内登录链接，带回跳 */
export function loginHref(redirectPath = '/'): string {
  const redirect =
    redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/';
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

const LOGIN_PROMO_KEY = 'ootd-login-promo-dismissed';

export function readLoginPromoDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LOGIN_PROMO_KEY) === '1';
}

export function writeLoginPromoDismissed(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOGIN_PROMO_KEY, '1');
}
