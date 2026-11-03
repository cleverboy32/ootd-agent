import { create } from 'zustand';
import { withBasePath } from '@/lib/utils';

export type SessionUser = {
  id: string;
  username: string;
  hasSecurityQuestions: boolean;
};

export type SessionSnapshot = {
  authenticated: boolean;
  user?: SessionUser;
};

type SessionStore = SessionSnapshot & {
  /** 是否已完成至少一次拉取（含未登录结果） */
  ready: boolean;
  ensureSession: (options?: { bust?: boolean }) => Promise<SessionSnapshot>;
  clearSession: () => void;
};

/** 并发 ensureSession 共用同一飞行中请求 */
let inflight: Promise<SessionSnapshot> | null = null;

async function loadSessionFromNetwork(): Promise<SessionSnapshot> {
  const res = await fetch(withBasePath('/api/auth/session'), {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`session ${res.status}`);
  }
  const data = (await res.json()) as SessionSnapshot;
  return {
    authenticated: Boolean(data.authenticated && data.user),
    user: data.authenticated && data.user ? data.user : undefined,
  };
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ready: false,
  authenticated: false,
  user: undefined,

  ensureSession: async (options) => {
    const bust = options?.bust === true;
    if (!bust && get().ready) {
      return {
        authenticated: get().authenticated,
        user: get().user,
      };
    }
    if (!bust && inflight) return inflight;

    const request = loadSessionFromNetwork()
      .then((snapshot) => {
        set({
          ready: true,
          authenticated: snapshot.authenticated,
          user: snapshot.user,
        });
        return snapshot;
      })
      .catch((error) => {
        set({ ready: true, authenticated: false, user: undefined });
        throw error;
      })
      .finally(() => {
        if (inflight === request) inflight = null;
      });

    inflight = request;
    return request;
  },

  clearSession: () => {
    inflight = null;
    set({ ready: true, authenticated: false, user: undefined });
  },
}));
