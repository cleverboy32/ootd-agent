"use client";

import { stripBasePath, withBasePath } from "@/lib/utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface AccessContextValue {
  /** 是否已登录（加载中为 false） */
  ready: boolean;
  authenticated: boolean;
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

export function AccessProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(withBasePath("/api/auth/session"), { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load session");
        return response.json() as Promise<{ authenticated: boolean }>;
      })
      .then((result) => {
        if (!active) return;
        setAuthenticated(Boolean(result.authenticated));
        setReady(true);
        if (!result.authenticated) redirectToLogin();
      })
      .catch(() => {
        if (!active) return;
        setAuthenticated(false);
        setReady(true);
        redirectToLogin();
      });
    return () => {
      active = false;
    };
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await fetch(withBasePath("/api/auth/logout"), {
      method: "POST",
      credentials: "same-origin",
    });
    setAuthenticated(false);
    redirectToLogin();
  }, []);

  const value = useMemo<AccessContextValue>(
    () => ({
      ready,
      authenticated,
      canMutate: authenticated,
      canInvokeAI: authenticated,
      logout,
    }),
    [authenticated, logout, ready]
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
