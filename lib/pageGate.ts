import { isGuestAllowedPath } from '@/lib/guestAccess';

/** 登录后的产品首页。未登录的 `/` 是营销页。 */
export const PRODUCT_HOME = '/home';

export type PageGateDecision =
  | { type: 'next' }
  | { type: 'redirect'; location: string };

function normalizePath(pathname: string): string {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function withSearch(path: string, search: string): string {
  if (!search || search === '?') return path;
  return `${path}${search.startsWith('?') ? search : `?${search}`}`;
}

/** 已登录时只接受站内产品路径，避免开放重定向和登录页循环。 */
function safeAuthedTarget(target: string | null): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return null;
  const path = normalizePath(target);
  if (path === '/' || path === '/login' || path.startsWith('/login/')) return null;
  if (isGuestAllowedPath(path)) return null;
  return target.startsWith('/') ? target : null;
}

/**
 * 页面分流。只看路径和「cookie 验签是否通过」，不查库。
 * `search` 可带或不带前导 `?`。
 */
export function resolvePageGate(input: {
  pathname: string;
  search?: string;
  hasSession: boolean;
}): PageGateDecision {
  const path = normalizePath(input.pathname);
  const search = input.search ?? '';

  if (path.startsWith('/api') || path.startsWith('/_next')) {
    return { type: 'next' };
  }

  if (input.hasSession && path === '/') {
    return { type: 'redirect', location: withSearch(PRODUCT_HOME, search) };
  }

  if (input.hasSession && (path === '/login' || path.startsWith('/login/'))) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const next = safeAuthedTarget(params.get('redirect'));
    return { type: 'redirect', location: next ?? PRODUCT_HOME };
  }

  // 未登录进产品页 → 官网简介页（不再丢登录表单）
  if (!input.hasSession && !isGuestAllowedPath(path)) {
    return { type: 'redirect', location: '/' };
  }

  return { type: 'next' };
}
