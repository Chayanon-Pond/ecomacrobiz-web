"use client";

import { useGsap } from "@/lib/animations/use-gsap";

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
      { opacity: 0.22 },
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
