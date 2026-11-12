"use client";

import Link from "next/link";
import { useCallback, type ReactNode } from "react";

/**
 * Card with a cursor-following spotlight + gradient border.
 * The glow is driven by CSS variables; pointer tracking is attached only for
 * mouse/pen input so touch devices never get "stuck" hover states. Keyboard
 * focus shows the same glow (:focus-visible) so nothing is hover-only.
 */
export function SpotlightCard({
  children,
  className = "",
  href,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
  ariaLabel?: string;
}) {
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  const cls = `spotlight rounded-[var(--radius-card)] bg-surface ${className}`;

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        onPointerMove={onPointerMove}
        className={cls}
        data-cursor="hover"
      >
        {children}
      </Link>
    );
  }
  return (
    <div onPointerMove={onPointerMove} className={cls}>
      {children}
    </div>
  );
}
