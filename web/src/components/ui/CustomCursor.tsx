"use client";

import { useEffect, useRef } from "react";
import { FINE_POINTER_QUERY } from "@/lib/animations/motion";
import { useMediaQuery, useMotionEnabled } from "@/lib/animations/use-media-query";

const INTERACTIVE =
  "a[href], button, summary, [role='button'], [data-cursor='hover'], input, textarea, select, label[for]";

/**
 * Cursor follower ring + dot. The native cursor stays visible (so the
 * required `cursor: pointer` affordance still works); the ring is an accent.
 * Mounted only for mouse/trackpad users with motion enabled — never on
 * touch devices, including iPad with finger input.
 */
export function CustomCursor() {
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const motion = useMotionEnabled();
  const enabled = finePointer && motion;
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const r = ring.current;
    const d = dot.current;
    if (!r || !d) return;

    let x = -100;
    let y = -100;
    let rx = x;
    let ry = y;
    let raf = 0;
    let visible = false;

    const loop = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      r.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(loop);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      x = e.clientX;
      y = e.clientY;
      d.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!visible) {
        visible = true;
        rx = x;
        ry = y;
        r.style.opacity = "1";
        d.style.opacity = "1";
      }
      const target = e.target as Element | null;
      r.dataset.active = target?.closest(INTERACTIVE) ? "true" : "false";
    };
    const leave = () => {
      visible = false;
      r.style.opacity = "0";
      d.style.opacity = "0";
    };

    raf = requestAnimationFrame(loop);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={ring} className="cursor-ring" style={{ opacity: 0 }} aria-hidden="true" />
      <div ref={dot} className="cursor-dot" style={{ opacity: 0 }} aria-hidden="true" />
    </>
  );
}
