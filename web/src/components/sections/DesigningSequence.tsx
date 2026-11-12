"use client";

import { designing } from "@/content/home";
import { useGsap } from "@/lib/animations/use-gsap";
import { MQ } from "@/lib/animations/gsap";

/**
 * Pinned sequence: "Designing" stays, the second line swaps on scroll.
 * Pinning uses CSS `position: sticky` (see .designing-* in globals.css), so
 * there is no pin-spacer/reflow jank on iOS Safari; GSAP only scrubs.
 * With reduced motion the lines render as a static list.
 */
export function DesigningSequence() {
  const ref = useGsap<HTMLElement>(({ gsap }, el) => {
    const lines = gsap.utils.toArray<HTMLElement>(".designing-line", el);
    const dots = gsap.utils.toArray<HTMLElement>("[data-dot]", el);
    const glow = el.querySelector("[data-designing-glow]");
    const mm = gsap.matchMedia();

    mm.add({ mobile: MQ.mobile, tablet: MQ.tabletUp }, (ctx) => {
      const { mobile } = ctx.conditions as { mobile: boolean };
      // Factories: GSAP mutates vars objects, so never share them between tweens.
      const hidden = () =>
        mobile
          ? { opacity: 0, yPercent: 50 }
          : { opacity: 0, yPercent: 60, filter: "blur(12px)" };
      const shown = () =>
        mobile
          ? { opacity: 1, yPercent: 0 }
          : { opacity: 1, yPercent: 0, filter: "blur(0px)" };
      const out = () =>
        mobile
          ? { opacity: 0, yPercent: -50 }
          : { opacity: 0, yPercent: -60, filter: "blur(12px)" };

      gsap.set(lines, hidden());
      gsap.set(lines[0], shown());

      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut", duration: 1 },
        scrollTrigger: {
          trigger: el,
          start: "top top",
          end: "bottom bottom",
          scrub: mobile ? true : 0.6,
          onUpdate: (self) => {
            const idx = Math.min(
              lines.length - 1,
              Math.floor(self.progress * lines.length * 0.999),
            );
            dots.forEach((d, i) => (d.dataset.active = String(i === idx)));
          },
        },
      });

      lines.forEach((line, i) => {
        if (i === 0) {
          tl.to({}, { duration: 0.6 });
        } else {
          tl.to(lines[i - 1], out()).fromTo(line, hidden(), shown(), "<0.15").to({}, { duration: 0.6 });
        }
      });

      if (glow) {
        gsap.fromTo(
          glow,
          { scale: 0.6, opacity: 0.4 },
          {
            scale: 1.3,
            opacity: 1,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: true },
          },
        );
      }
    });
  });

  return (
    <section
      ref={ref}
      aria-labelledby="designing-title"
      className="designing-track border-y border-line bg-ink-2"
    >
      <h2 id="designing-title" className="sr-only">
        {designing.lines.map((l) => `${designing.lead} ${l}`).join(", ")}
      </h2>
      <div className="designing-stage relative flex items-center overflow-hidden py-24 [[data-motion=full]_&]:py-0">
        <div
          data-designing-glow
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-[min(110vw,70rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.28),transparent_62%)]"
        />
        <div className="container-page relative" aria-hidden="true">
          <div className="mb-[clamp(2rem,6vh,4rem)] flex flex-wrap items-center justify-between gap-x-6 gap-y-2 font-display text-[0.75rem] font-semibold tracking-[0.24em] text-subtle">
            <span>{designing.kicker[0]}</span>
            <span className="hidden h-px flex-1 bg-line sm:block" />
            <span className="text-accent-soft">{designing.kicker[1]}</span>
          </div>

          <p className="display-tight text-[clamp(2.4rem,9vw,10rem)] font-bold text-subtle">
            {designing.lead}
          </p>
          <div className="relative [[data-motion=full]_&]:h-[2.05em] text-[clamp(2.4rem,9vw,10rem)]">
            {designing.lines.map((line) => (
              <p
                key={line}
                className="designing-line display-tight flex items-start pt-[0.04em] font-bold text-fg will-change-transform text-balance-safe"
              >
                <span className="bg-gradient-to-br from-white via-white to-accent-soft bg-clip-text pb-[0.1em] text-transparent">
                  {line}
                </span>
              </p>
            ))}
          </div>

          <div className="mt-[clamp(2rem,6vh,4rem)] hidden items-center gap-2 [[data-motion=full]_&]:flex">
            {designing.lines.map((line, i) => (
              <span
                key={line}
                data-dot
                data-active={i === 0}
                className="h-1 w-6 rounded-full bg-line-strong transition-all duration-500 data-[active=true]:w-12 data-[active=true]:bg-accent"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
