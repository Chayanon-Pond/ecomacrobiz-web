"use client";

/**
 * Accessible auth dialog: role=dialog + aria-modal, labelled by the
 * contextual title, focus trapped, Esc / overlay / close button / drag-down
 * (phones) dismiss, the rest of the page inert + scroll-locked (Lenis aware),
 * focus returned on close. Centered card ≥ 640px, bottom sheet below.
 */
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Me } from "@/lib/community/types";
import { lockScroll } from "@/lib/animations/scroll-store";
import { hasFinePointer, isMotionEnabled } from "@/lib/animations/motion";
import type { AuthReason, OpenAuthOptions } from "./open-auth";
import { AuthPanel, type AuthSuccessInfo } from "./AuthPanel";
import "./auth.css";

const TITLES: Record<AuthReason, string> = {
  like: "เข้าสู่ระบบเพื่อกดถูกใจ",
  comment: "เข้าสู่ระบบเพื่อแสดงความคิดเห็น",
  reply: "เข้าสู่ระบบเพื่อตอบกลับความคิดเห็น",
  report: "เข้าสู่ระบบเพื่อรายงานความคิดเห็น",
  generic: "เข้าสู่ระบบสมาชิก",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

type Phase = "enter" | "open" | "closing";
type Done = { me: Me; info: AuthSuccessInfo } | null;

export function AuthModal({
  options,
  host,
  onClosed,
}: {
  options: OpenAuthOptions;
  /** The body-level container this modal is rendered into (kept interactive). */
  host: HTMLElement;
  onClosed: (me: Me | null) => void;
}) {
  const titleId = useId();
  const descId = useId();
  const [phase, setPhase] = useState<Phase>("enter");
  const [done, setDone] = useState<Done>(null);
  const [drag, setDrag] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<Me | null>(null);
  const closingRef = useRef(false);
  const dragStart = useRef<{ y: number; t: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fine] = useState(hasFinePointer);

  const close = useCallback(
    (me: Me | null) => {
      if (closingRef.current) return;
      closingRef.current = true;
      resultRef.current = me;
      setPhase("closing");
      const ms = isMotionEnabled() ? 300 : 200;
      window.setTimeout(() => onClosed(resultRef.current), ms);
    },
    [onClosed],
  );

  // Open: inert siblings, lock scroll, animate in, initial focus.
  useEffect(() => {
    const siblings = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el !== host && el instanceof HTMLElement && !el.inert,
    );
    for (const el of siblings) el.inert = true;
    lockScroll(true);
    // Flush the "enter" styles, then transition (a timer, not rAF: rAF never fires in a background tab).
    void panelRef.current?.offsetHeight;
    const raf = window.setTimeout(() => setPhase("open"), 16);
    if (!fine) panelRef.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(raf);
      for (const el of siblings) el.inert = false;
      lockScroll(false);
    };
  }, [host, fine]);

  // Esc + focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(done?.me ?? null);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, done]);

  const onSuccess = (me: Me, info: AuthSuccessInfo) => {
    setDone({ me, info });
    // A brief confirmation; stay open when there is something to read.
    if (!info.verificationSent) window.setTimeout(() => close(me), 900);
  };

  // Drag-to-dismiss (bottom sheet, phones). Starts on the handle/header only.
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(min-width: 640px)").matches || e.button !== 0) return;
    dragStart.current = { y: e.clientY, t: performance.now() };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setDrag(Math.max(0, e.clientY - dragStart.current.y));
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const dy = Math.max(0, e.clientY - dragStart.current.y);
    const v = dy / Math.max(1, performance.now() - dragStart.current.t);
    dragStart.current = null;
    setDragging(false);
    if (dy > 120 || (dy > 40 && v > 0.6)) close(done?.me ?? null);
    else setDrag(0);
  };

  const title = TITLES[options.reason] ?? TITLES.generic;

  return (
    <div
      className="ca-root fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
      data-state={phase === "enter" ? "enter" : phase}
      data-dragging={dragging || undefined}
      style={{ ["--ca-drag" as string]: `${drag}px` }}
    >
      <div aria-hidden="true" className="ca-overlay absolute inset-0" onClick={() => close(done?.me ?? null)} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        data-lenis-prevent
        className="ca-panel relative flex max-h-[min(94dvh,52rem)] w-full flex-col overflow-y-auto rounded-t-[1.75rem] border border-b-0 border-line-strong bg-surface shadow-[0_-20px_60px_rgb(0_0_0/0.5)] outline-none sm:max-w-[27rem] sm:rounded-[var(--radius-card)] sm:border-b sm:shadow-[0_30px_80px_rgb(0_0_0/0.6)]"
      >
        <div
          className="sticky top-0 z-10 touch-none bg-surface/95 px-5 pb-3 pt-2 backdrop-blur sm:static sm:px-7 sm:pt-6 sm:backdrop-blur-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="thai-heading text-[1.3rem] font-semibold leading-snug sm:text-[1.4rem]">
                {done ? (done.info.registered ? "สมัครสมาชิกเรียบร้อย" : "เข้าสู่ระบบเรียบร้อย") : title}
              </h2>
              <p id={descId} className="mt-1 text-sm text-muted">
                {done ? `ยินดีต้อนรับ ${done.me.display_name}` : "สมาชิกแสดงความคิดเห็นและกดถูกใจบทความได้"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => close(done?.me ?? null)}
              aria-label="ปิดหน้าต่าง"
              className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-fg"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 pb-1 pt-2 sm:px-7">
          {done ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center" role="status">
              <span aria-hidden="true" className="ca-success-pop grid size-14 place-items-center rounded-full bg-accent text-white">
                <svg viewBox="0 0 20 20" className="size-7">
                  <path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {done.info.verificationSent ? (
                <>
                  <p className="leading-7 text-muted">เราส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว กรุณาเปิดอีเมลแล้วกดลิงก์เพื่อยืนยัน</p>
                  <button type="button" className="ca-btn ca-btn-primary w-full" onClick={() => close(done.me)} autoFocus>
                    ตกลง
                  </button>
                </>
              ) : (
                <p className="text-muted">กำลังพากลับไป…</p>
              )}
            </div>
          ) : (
            <AuthPanel
              initialTab={options.tab ?? "login"}
              pending={options.pending}
              onSuccess={onSuccess}
              autoFocus={fine}
            />
          )}
        </div>
      </div>
    </div>
  );
}
