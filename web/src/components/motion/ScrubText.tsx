"use client";

import { useGsap } from "@/lib/animations/use-gsap";

/**
 * Opacity of not-yet-read words. 0.42 on the near-black background gives a
 * 3.8:1 contrast (WCAG AA for large text; every ScrubText is >= 24px), so the
 * text stays readable before/without scrolling. Mirrors globals.css.
 */
const SCRUB_DIM = 0.42;

/**
 * Apple-style "read as you scroll" text: words brighten progressively with
 * scroll position. Segments come pre-split from the server (Thai-aware).
 * Spans are inline (not inline-block) so native Thai line breaking is kept.
 */
export function ScrubText({
  segments,
  className,
  as: Tag = "p",
}: {
  segments: string[];
  className?: string;
  as?: "p" | "h2";
}) {
  const ref = useGsap<HTMLElement>(({ gsap }, el) => {
    const words = el.querySelectorAll(".scrub-word");
    gsap.fromTo(
      words,
      { opacity: SCRUB_DIM },
      {
        opacity: 1,
        ease: "none",
        stagger: 0.1,
        scrollTrigger: {
          trigger: el,
          start: "top 80%",
          end: "bottom 45%",
          scrub: 0.4,
        },
      },
    );
  });

  return (
    <Tag ref={ref as React.RefObject<HTMLParagraphElement>} className={className}>
      {segments.map((s, i) =>
        /^\s+$/.test(s) ? (
          s
        ) : (
          <span key={i} className="scrub-word">
            {s}
          </span>
        ),
      )}
    </Tag>
  );
}
