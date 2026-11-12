"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { hasFinePointer, isMotionEnabled } from "@/lib/animations/motion";

type Variant = "primary" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none " +
  "transition-[background-color,box-shadow,color,border-color] duration-300 " +
  "focus-visible:outline-2 focus-visible:outline-offset-4";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-[0_0_0_0_var(--accent-glow)] hover:shadow-[0_10px_40px_-6px_var(--accent-glow)] active:brightness-110",
  ghost:
    "border border-line-strong text-fg hover:border-fg/50 hover:bg-white/5 active:bg-white/10",
};

const sizes: Record<Size, string> = {
  sm: "min-h-10 px-4 text-sm",
  md: "min-h-12 px-6 text-[0.95rem]",
  lg: "min-h-14 px-8 text-base sm:text-lg",
};

type Props = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  /** strength of the magnetic pull in px */
  strength?: number;
  external?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
};

/**
 * Link styled as a button with a magnetic hover effect.
 * Magnetism only activates for fine pointers with motion enabled, so
 * touch devices (phones, iPad) get a normal, stable tap target.
 */
export function MagneticButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
  strength = 14,
  external,
  onClick,
  ariaLabel,
}: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    const inner = innerRef.current;
    if (!el || !inner || !hasFinePointer() || !isMotionEnabled()) return;

    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate3d(${x * strength}px, ${y * strength}px, 0)`;
        inner.style.transform = `translate3d(${x * strength * 0.35}px, ${y * strength * 0.35}px, 0)`;
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = "";
      inner.style.transform = "";
    };
    el.style.transition = "transform 0.5s cubic-bezier(0.16,1,0.3,1)";
    inner.style.transition = "transform 0.5s cubic-bezier(0.16,1,0.3,1)";
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);

  const cls = `${base} ${variants[variant]} ${sizes[size]} ${className}`;
  const content = (
    <span ref={innerRef} className="inline-flex items-center gap-2">
      {children}
    </span>
  );

  if (external) {
    return (
      <a
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        onClick={onClick}
        aria-label={ariaLabel}
        data-cursor="hover"
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      ref={ref}
      href={href}
      className={cls}
      onClick={onClick}
      aria-label={ariaLabel}
      data-cursor="hover"
    >
      {content}
    </Link>
  );
}

export function ArrowIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
