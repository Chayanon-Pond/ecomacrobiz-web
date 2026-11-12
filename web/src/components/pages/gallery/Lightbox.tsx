"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Image, { getImageProps } from "next/image";
import type { GalleryImage } from "@/content/gallery";
import { lockScroll } from "@/lib/animations/scroll-store";

const SWIPE_MIN_PX = 50;
const SIZES = "(min-width: 1280px) 80vw, 100vw";

/**
 * Accessible image viewer (loaded on demand — see GalleryGrid).
 * Modal dialog with focus trap, Esc to close, Left/Right (and swipe) to
 * navigate, counter, caption, body scroll lock, neighbour preloading.
 * Focus is restored to the opening tile by the parent on close.
 */
export default function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const count = images.length;
  const image = images[index];

  const go = useCallback(
    (delta: number) => onIndexChange((index + delta + count) % count),
    [index, count, onIndexChange],
  );

  // Scroll lock + initial focus.
  useEffect(() => {
    lockScroll(true);
    closeRef.current?.focus();
    return () => lockScroll(false);
  }, []);

  // Preload the neighbours with the same srcset the <Image> will request.
  useEffect(() => {
    for (const delta of [1, -1]) {
      const n = images[(index + delta + count) % count];
      const { props } = getImageProps({ src: n.src, alt: "", width: n.width, height: n.height, sizes: SIZES });
      const img = new window.Image();
      if (props.srcSet) img.srcset = props.srcSet;
      if (props.sizes) img.sizes = props.sizes;
      img.src = props.src;
    }
  }, [index, images, count]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Tab") {
      const dialog = dialogRef.current;
      if (!dialog) return;
      // Only elements actually rendered (prev/next exist twice, one per layout).
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
  };

  const titleId = "gal-lb-title";
  const captionId = "gal-lb-caption";
  const btn =
    "size-12 items-center justify-center rounded-full border border-line-strong bg-ink/70 text-fg backdrop-blur transition-colors hover:border-fg/60 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2";

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={captionId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="gal-lb outline-none fixed inset-0 z-[80] flex flex-col bg-ink/95 backdrop-blur-xl"
      data-lenis-prevent
    >
      <div className="flex items-center justify-between gap-4 px-[var(--gutter)] pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="font-display text-sm font-semibold tracking-[0.18em] text-muted" aria-live="polite">
          <span className="sr-only">ภาพที่ </span>
          {index + 1} / {count}
        </p>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิด" className={`${btn} inline-flex`} data-cursor="hover">
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div
        className="gal-lb-stage relative min-h-0 flex-1 select-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointer.current = null)}
      >
        <figure key={image.id} className="gal-lb-figure absolute inset-0 m-0 px-[var(--gutter)] py-2 md:px-24">
          <div className="relative size-full">
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes={SIZES}
              className="object-contain"
              draggable={false}
              loading="eager"
              fetchPriority="high"
            />
          </div>
        </figure>

        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="ภาพก่อนหน้า"
          className={`${btn} absolute left-3 top-1/2 hidden -translate-y-1/2 md:inline-flex lg:left-6`}
          data-cursor="hover"
        >
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
            <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="ภาพถัดไป"
          className={`${btn} absolute right-3 top-1/2 hidden -translate-y-1/2 md:inline-flex lg:right-6`}
          data-cursor="hover"
        >
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
            <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="flex items-end justify-between gap-4 px-[var(--gutter)] pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="min-w-0">
          <h2 id={titleId} className="display-tight text-[clamp(1.4rem,3vw,2rem)] font-bold">
            {image.title}
          </h2>
          <p id={captionId} className="mt-1 text-sm leading-[1.7] text-muted">
            {image.caption}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 md:hidden">
          <button type="button" onClick={() => go(-1)} aria-label="ภาพก่อนหน้า" className={`${btn} inline-flex`}>
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
              <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" onClick={() => go(1)} aria-label="ภาพถัดไป" className={`${btn} inline-flex`}>
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
              <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
