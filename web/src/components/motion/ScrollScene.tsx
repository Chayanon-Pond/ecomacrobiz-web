"use client";

import type { ReactNode } from "react";
import { useGsap } from "@/lib/animations/use-gsap";
import { MQ, type GsapBundle } from "@/lib/animations/gsap";

/**
 * Generic scroll-scrubbed scene for server-rendered content.
 * Children stay server components; only this wrapper ships JS.
 * Targets are found via data attributes inside the scene:
 *   [data-scene="hero"]          hero exit (scale/fade as you scroll away)
 *   [data-scene="zoom-media"]    media that opens from inset to full bleed
 */
type Preset = "hero" | "zoom-media";

const presets: Record<Preset, (b: GsapBundle, el: HTMLElement) => void> = {
  hero: ({ gsap }, el) => {
    const mm = gsap.matchMedia();
    mm.add(
      { tablet: MQ.tabletUp, mobile: MQ.mobile },
      (ctx) => {
        const { tablet } = ctx.conditions as { tablet: boolean };
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom top",
            scrub: tablet ? 0.6 : true,
          },
          defaults: { ease: "none" },
        });
        tl.to(el.querySelector("[data-hero-wordmark]"), {
          scale: tablet ? 0.86 : 0.94,
          yPercent: tablet ? -18 : -8,
          opacity: 0.15,
          transformOrigin: "50% 100%",
        }, 0)
          .to(el.querySelector("[data-hero-meta]"), { yPercent: -30, opacity: 0 }, 0)
          .to(el.querySelectorAll("[data-hero-light]"), { yPercent: 25, opacity: 0.4 }, 0);
      },
    );
  },
  "zoom-media": ({ gsap }, el) => {
    const media = el.querySelector<HTMLElement>("[data-zoom-media]");
    if (!media) return;
    const mm = gsap.matchMedia();
    // Tablet & desktop: inset → full-bleed. Phones: a light scale only.
    mm.add(MQ.tabletUp, () => {
      gsap.fromTo(
        media,
        { clipPath: "inset(12% 10% 12% 10% round 32px)" },
        {
          clipPath: "inset(0% 0% 0% 0% round 0px)",
          ease: "none",
          scrollTrigger: { trigger: el, start: "top 85%", end: "top 15%", scrub: 0.5 },
        },
      );
      gsap.fromTo(
        media.querySelector("img"),
        { scale: 1.25 },
        {
          scale: 1,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        },
      );
    });
    mm.add(MQ.mobile, () => {
      gsap.fromTo(
        media.querySelector("img"),
        { scale: 1.15 },
        {
          scale: 1,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        },
      );
    });
  },
};

export function ScrollScene({
  preset,
  children,
  className,
  as: Tag = "div",
  id,
  ariaLabelledby,
}: {
  preset: Preset;
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
  id?: string;
  ariaLabelledby?: string;
}) {
  const ref = useGsap<HTMLElement>((bundle, el) => presets[preset](bundle, el));
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      id={id}
      aria-labelledby={ariaLabelledby}
    >
      {children}
    </Tag>
  );
}
