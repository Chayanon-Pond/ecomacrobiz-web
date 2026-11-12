"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; text: string };

const Ctx = createContext<((text: string, tone?: Tone) => void) | null>(null);

export function useToast() {
  const v = use(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, tone: Tone = "success") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);

  const value = useMemo(() => push, [push]);
  return (
    <Ctx value={value}>
      {children}
      <div className="adm-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="adm-toast" data-tone={t.tone}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx>
  );
}
