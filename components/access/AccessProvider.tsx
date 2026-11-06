"use client";

import { isGuestAllowedPath } from "@/lib/guestAccess";
import { navigateWithAuthBoot } from "@/lib/authBoot";
import { logout as logoutRequest } from "@/lib/api/auth";
import { stripBasePath, withBasePath } from "@/lib/utils";
import { useSessionStore, type SessionUser } from "@/store/session";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

interface AccessContextValue {
  /** 是否已完成 session hydrate（加载中为 false） */
  ready: boolean;
  authenticated: boolean;
  user?: SessionUser;
  canMutate: boolean;
  canInvokeAI: boolean;
  logout: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const path = stripBasePath(window.location.pathname);
  if (path.startsWith("/login")) return;
  const current = path + window.location.search;
  window.location.href = withBasePath(`/login?redirect=${encodeURIComponent(current)}`);
}

/** 未登录：仅首页/登录页可停留，其余跳登录 */
function redirectUnlessGuestAllowed(): void {
  if (typeof window === "undefined") return;
  const path = stripBasePath(window.location.pathname);
  if (isGuestAllowedPath(path)) return;
  redirectToLogin();
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const ready = useSessionStore((s) => s.ready);
  const authenticated = useSessionStore((s) => s.authenticated);
  const user = useSessionStore((s) => s.user);
  const ensureSession = useSessionStore((s) => s.ensureSession);
  const clearSession = useSessionStore((s) => s.clearSession);

  useEffect(() => {
    let active = true;
    void ensureSession()
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.authenticated) redirectUnlessGuestAllowed();
      })
      .catch(() => {
        if (!active) return;
        // 查库瞬态失败：再试一次；仍失败则只对非访客页跳登录，不伪造首页未登录
        void ensureSession({ bust: true })
          .then((snapshot) => {
            if (!active) return;
            if (!snapshot.authenticated) redirectUnlessGuestAllowed();
          })
          .catch(() => {
            if (!active) return;
            redirectUnlessGuestAllowed();
          });
      });
    return () => {
      active = false;
    };
  }, [ensureSession]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutRequest();
    } catch {
      clearSession();
    }
    const path = stripBasePath(window.location.pathname);
    // 首页允许访客：退出后留在首页并刷新为未登录态，不进 /login
    if (isGuestAllowedPath(path) && path !== "/login" && !path.startsWith("/login/")) {
      navigateWithAuthBoot(withBasePath("/"), "正在退出…");
      return;
    }
    navigateWithAuthBoot(
      withBasePath(`/login?redirect=${encodeURIComponent(path + window.location.search)}`),
      "正在退出…"
    );
  }, [clearSession]);

  const value = useMemo<AccessContextValue>(
    () => ({
      ready,
      authenticated,
      user,
      canMutate: authenticated,
      canInvokeAI: authenticated,
      logout,
    }),
    [authenticated, logout, ready, user]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error("useAccess must be used within AccessProvider");
  }
  return context;
}
