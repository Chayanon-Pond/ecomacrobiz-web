"use client";

/**
 * Toasts. Backward compatible with the original API:
 *   const toast = useToast(); toast("บันทึกแล้ว"); toast("ผิดพลาด", "error");
 * plus helpers: toast.success / toast.error / toast.info / toast.warning,
 * and an optional action: toast("ลบแล้ว", "info", { action: { label: "เลิกทำ", onClick } }).
 * Errors stay 8s, others 4.5s; hover/focus pauses dismissal. Max 4 visible.
 */
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "error" | "info" | "warning";
type ToastOpts = { action?: { label: string; onClick: () => void }; duration?: number };
type ToastItem = { id: number; tone: ToastTone; text: string; opts?: ToastOpts };

type ToastFn = ((text: string, tone?: ToastTone, opts?: ToastOpts) => void) & {
  success: (text: string, opts?: ToastOpts) => void;
  error: (text: string, opts?: ToastOpts) => void;
  info: (text: string, opts?: ToastOpts) => void;
  warning: (text: string, opts?: ToastOpts) => void;
};

const Ctx = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const v = use(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

const ICON: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const value = useMemo(() => {
    const push = ((text: string, tone: ToastTone = "success", opts?: ToastOpts) => {
      if (!text) return;
      const id = ++seq.current;
      // Same message already showing: don't stack duplicates.
      setToasts((t) => (t.some((x) => x.text === text && x.tone === tone) ? t : [...t, { id, tone, text, opts }].slice(-4)));
    }) as ToastFn;
    push.success = (t, o) => push(t, "success", o);
    push.error = (t, o) => push(t, "error", o);
    push.info = (t, o) => push(t, "info", o);
    push.warning = (t, o) => push(t, "warning", o);
    return push;
  }, []);

  return (
    <Ctx value={value}>
      {children}
      <div className="adm-toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const Icon = ICON[item.tone];
  const duration = item.opts?.duration ?? (item.tone === "error" ? 8000 : 4500);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(t);
  }, [paused, duration, item.id, onDismiss]);

  return (
    <div
      className="adm-toast"
      data-tone={item.tone}
      role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={18} aria-hidden="true" />
      <div className="adm-toast-text">
        {item.text}
        {item.opts?.action ? (
          <button
            type="button"
            className="adm-link ml-2 text-sm font-medium"
            onClick={() => {
              item.opts?.action?.onClick();
              onDismiss(item.id);
            }}
          >
            {item.opts.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" className="adm-icon-btn -my-1 -mr-1.5" data-size="sm" aria-label="ปิดการแจ้งเตือน" onClick={() => onDismiss(item.id)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
