export type AuthMode = 'user' | 'access';

/** AUTH_MODE=user 启用登录体系；缺省/其他值均为 access（访问码单用户模式） */
export function getAuthMode(): AuthMode {
  return process.env.AUTH_MODE?.trim() === 'user' ? 'user' : 'access';
}
