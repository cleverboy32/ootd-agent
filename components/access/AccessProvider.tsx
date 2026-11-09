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

/** 未登录：仅营销页和登录页可停留，产品页回官网简介 */
function redirectUnlessGuestAllowed(): void {
  if (typeof window === "undefined") return;
  const path = stripBasePath(window.location.pathname);
  if (isGuestAllowedPath(path)) return;
  window.location.href = withBasePath("/");
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
        // 查库瞬态失败：再试一次；仍失败则只对非访客页回官网，不伪造首页未登录
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
    // 退出后回到未登录营销页，不进登录表单
    navigateWithAuthBoot(withBasePath("/"), "正在退出…");
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
