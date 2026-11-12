"use client";

import "./purpose.css";
import type { Lens } from "@/content/purpose";
import { useGsap } from "@/lib/animations/use-gsap";

const PIN_QUERY = "(min-width: 768px) and (min-height: 640px)";

/**
 * "How we think": the five lenses light up one by one while the stage is
 * held with CSS sticky (tablet/desktop, motion on). GSAP only reads scroll
 * progress. Phones, short landscape screens and reduced motion get the
 * same list fully visible.
 */
export function PurposeLenses({
  eyebrow,
  title,
  intro,
  lenses,
  closing,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  lenses: Lens[];
  closing: string;
}) {
  const ref = useGsap<HTMLElement>(({ gsap, ScrollTrigger }, el) => {
    const items = gsap.utils.toArray<HTMLElement>("[data-lens]", el);
    const dots = gsap.utils.toArray<HTMLElement>(".pp-lens-dot", el);
    const track = el.querySelector<HTMLElement>(".pp-lens-track");
    if (!track) return;
    const mm = gsap.matchMedia();
    mm.add(PIN_QUERY, () => {
      let current = -1;
      const setActive = (idx: number) => {
        if (idx === current) return;
        current = idx;
        items.forEach((it, i) => (it.dataset.active = String(i === idx)));
        dots.forEach((d, i) => (d.dataset.active = String(i === idx)));
      };
      ScrollTrigger.create({
        trigger: track,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) =>
          setActive(Math.min(items.length - 1, Math.floor(self.progress * items.length * 0.999))),
      });
      return () => {
        items.forEach((it, i) => (it.dataset.active = String(i === 0)));
        dots.forEach((d, i) => (d.dataset.active = String(i === 0)));
      };
    });
  });

  return (
    <section ref={ref} aria-labelledby="lenses-title" className="border-t border-line">
      <div className="pp-lens-track">
        <div className="pp-lens-stage">
          <div className="container-page grid w-full gap-10 py-[clamp(5rem,12vh,8rem)] md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-12 lg:gap-20">
            <div className="md:self-center">
              <p className="eyebrow mb-5">{eyebrow}</p>
              <h2
                id="lenses-title"
                className="display-tight text-balance-safe text-[clamp(2.25rem,5vw,4.5rem)] font-bold"
              >
                {title}
              </h2>
              <p className="mt-6 max-w-md text-[clamp(1rem,1.4vw,1.15rem)] leading-[1.9] text-muted">
                {intro}
              </p>
              <div className="pp-lens-progress mt-10 items-center gap-2" aria-hidden="true">
                {lenses.map((l, i) => (
                  <span
                    key={l.title}
                    data-active={i === 0}
                    className="pp-lens-dot h-1 w-6 rounded-full bg-line-strong"
                  />
                ))}
              </div>
            </div>

            <ol className="flex flex-col divide-y divide-line border-y border-line">
              {lenses.map((l, i) => (
                <li key={l.title} data-lens data-active={i === 0} className="py-5 sm:py-6">
                  <div className="pp-lens-body grid gap-2 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-4">
                    <span className="font-display text-sm font-semibold tracking-[0.2em] text-accent-soft sm:pt-3">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="display-tight text-[clamp(1.9rem,3.8vw,3.4rem)] font-bold">
                        {l.title}
                      </h3>
                      <p className="mt-2 text-[clamp(0.98rem,1.3vw,1.1rem)] leading-[1.8] text-muted">
                        {l.description}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="container-page pb-[clamp(5rem,12vh,8rem)]">
        <p
          data-reveal
          className="ml-auto max-w-3xl border-l-2 border-accent pl-5 text-[clamp(1rem,1.5vw,1.2rem)] font-medium leading-[1.9] text-fg"
        >
          {closing}
        </p>
      </div>
    </section>
  );
}
