'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AuthPanel, safeRedirect, type AuthPanelKind } from '@/components/auth/AuthPanel';

type OpenAuthModalOptions = {
  redirect?: string;
  panel?: AuthPanelKind;
};

type AuthModalContextValue = {
  openAuthModal: (options?: OpenAuthModalOptions) => void;
  closeAuthModal: () => void;
};

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [redirect, setRedirect] = useState('/');
  const [panel, setPanel] = useState<AuthPanelKind>('login');
  const [instanceKey, setInstanceKey] = useState(0);

  const openAuthModal = useCallback((options?: OpenAuthModalOptions) => {
    setRedirect(safeRedirect(options?.redirect));
    setPanel(options?.panel ?? 'login');
    setInstanceKey((k) => k + 1);
    setOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ openAuthModal, closeAuthModal }),
    [openAuthModal, closeAuthModal]
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) closeAuthModal();
          else setOpen(true);
        }}
      >
        <DialogContent
          className="max-h-[min(90vh,40rem)] w-full overflow-y-auto p-6 sm:max-w-[420px]"
          showCloseButton
        >
          <DialogHeader className="sr-only">
            <DialogTitle>登录或注册</DialogTitle>
            <DialogDescription>登录后同步衣橱、档案与搭配记录</DialogDescription>
          </DialogHeader>
          <AuthPanel
            key={instanceKey}
            variant="modal"
            redirect={redirect}
            initialPanel={panel}
            onRequestClose={closeAuthModal}
          />
        </DialogContent>
      </Dialog>
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) {
    throw new Error('useAuthModal must be used within AuthModalProvider');
  }
  return ctx;
}
