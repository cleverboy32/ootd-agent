"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AccessMode = "loading" | "browse" | "verified";

interface AccessContextValue {
  mode: AccessMode;
  configured: boolean;
  canMutate: boolean;
  canInvokeAI: boolean;
  verify: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AccessMode>("loading");
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/access/status", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load access status");
        return response.json() as Promise<{
          mode: "browse" | "verified";
          configured: boolean;
        }>;
      })
      .then((result) => {
        if (!active) return;
        setMode(result.mode);
        setConfigured(result.configured);
      })
      .catch(() => {
        if (active) setMode("browse");
      });
    return () => {
      active = false;
    };
  }, []);

  const verify = useCallback(async (code: string): Promise<void> => {
    const response = await fetch("/api/access/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) throw new Error(body?.error || "验证失败");
    setMode("verified");
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await fetch("/api/access/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setMode("browse");
  }, []);

  const value = useMemo<AccessContextValue>(
    () => ({
      mode,
      configured,
      canMutate: mode === "verified",
      canInvokeAI: mode === "verified",
      verify,
      logout,
    }),
    [configured, logout, mode, verify]
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
