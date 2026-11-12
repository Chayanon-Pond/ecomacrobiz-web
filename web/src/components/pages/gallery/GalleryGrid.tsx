"use client";

import "./gallery.css";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { GalleryGroup, GalleryImage } from "@/content/gallery";

// Loaded only when a tile is first opened (warmed on hover/focus).
const loadLightbox = () => import("./Lightbox");
const Lightbox = dynamic(loadLightbox, { ssr: false });

type Section = {
  group: GalleryGroup;
  eyebrow: string;
  title: string;
  titleTh: string;
  /** Image ids per justified row */
  rows: string[][];
};

export function GalleryGrid({ images, sections }: { images: GalleryImage[]; sections: Section[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  // Activity (cache components) keeps this page alive when navigating away:
  // close the viewer when the page is hidden so it never comes back open.
  useLayoutEffect(() => () => setOpen(null), []);

  const openAt = (i: number, el: HTMLElement) => {
    trigger.current = el;
    setOpen(i);
  };

  const close = useCallback(() => {
    setOpen(null);
    const el = trigger.current;
    // Wait for the dialog to unmount before returning focus.
    requestAnimationFrame(() => el?.focus({ preventScroll: true }));
  }, []);

  const indexOf = (id: string) => images.findIndex((img) => img.id === id);
  const firstId = sections[0]?.rows[0]?.[0];

  return (
    <>
      {sections.map((s) => (
        <section
          key={s.group}
          aria-labelledby={`gal-${s.group}-title`}
          className="container-page py-[clamp(3rem,9vh,6rem)]"
        >
          <div className="mb-[clamp(1.5rem,4vh,2.5rem)] flex flex-col gap-3 md:flex-row md:items-end md:justify-between" data-reveal>
            <div>
              <p className="eyebrow mb-3">{s.eyebrow}</p>
              <h2
                id={`gal-${s.group}-title`}
                className="display-tight text-[clamp(2rem,4.6vw,4rem)] font-bold"
              >
                {s.title}
              </h2>
            </div>
            <p className="thai-heading max-w-md text-[clamp(1rem,1.4vw,1.15rem)] text-muted md:text-right">
              {s.titleTh}
            </p>
          </div>

          <ul className="flex flex-col gap-[clamp(0.75rem,1.4vw,1.25rem)]">
            {s.rows.map((row) => (
              <li key={row.join("+")} className="gal-row">
                {row.map((id) => {
                  const i = indexOf(id);
                  const img = images[i];
                  if (!img) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-reveal
                      data-cursor="hover"
                      onClick={(e) => openAt(i, e.currentTarget)}
                      onPointerEnter={loadLightbox}
                      onFocus={loadLightbox}
                      aria-haspopup="dialog"
                      aria-label={`เปิดภาพ ${img.title} แบบเต็มจอ (${i + 1} จาก ${images.length})`}
                      className="gal-tile group relative block overflow-hidden rounded-[var(--radius-card)] bg-surface text-left"
                      style={
                        {
                          "--ar": `${img.width} / ${img.height}`,
                          "--grow": img.width / img.height,
                        } as React.CSSProperties
                      }
                    >
                      <Image
                        src={img.src}
                        alt={img.alt}
                        fill
                        sizes="(min-width: 1440px) 42rem, (min-width: 768px) 50vw, 100vw"
                        className="gal-tile-img object-cover"
                        loading={id === firstId ? "eager" : "lazy"}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/80 to-transparent"
                      />
                      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5">
                        <span className="min-w-0">
                          <span className="block font-display text-[1.05rem] font-semibold text-white sm:text-lg">
                            {img.title}
                          </span>
                          <span className="block truncate text-xs text-white/75 sm:text-sm">{img.caption}</span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/40 bg-ink/40 text-white backdrop-blur transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
                        >
                          <svg viewBox="0 0 20 20" className="size-4" fill="none">
                            <path
                              d="M11.5 3.5h5v5M8.5 16.5h-5v-5M16.5 3.5 11 9M3.5 16.5 9 11"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {open !== null && (
        <Lightbox images={images} index={open} onIndexChange={setOpen} onClose={close} />
      )}
    </>
  );
}
