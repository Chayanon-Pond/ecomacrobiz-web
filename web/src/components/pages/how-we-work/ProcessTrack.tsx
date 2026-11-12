"use client";

import "./how-we-work.css";
import { useEffect, useState } from "react";
import type { ProcessStep } from "@/content/how-we-work";
import { useGsap } from "@/lib/animations/use-gsap";
import { MQ } from "@/lib/animations/gsap";

/**
 * Process storytelling.
 * Desktop (lg+): a sticky panel shows the current step number/title and a
 * progress line scrubbed by scroll (GSAP, motion on only) while the step
 * cards scroll past. Phones/tablets: a vertical timeline.
 * Active step comes from IntersectionObserver, so it also works with
 * reduced motion (where the progress line is simply hidden).
 */
export function ProcessTrack({
  eyebrow,
  title,
  intro,
  steps,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  steps: ProcessStep[];
}) {
  const [active, setActive] = useState(0);
  const total = String(steps.length).padStart(2, "0");

  const ref = useGsap<HTMLElement>(({ gsap }, el) => {
    const list = el.querySelector<HTMLElement>("[data-steps]");
    const fills = el.querySelectorAll<HTMLElement>("[data-progress-fill]");
    if (!list || fills.length === 0) return;
    const mm = gsap.matchMedia();
    mm.add(MQ.desktop, () => {
      gsap.fromTo(
        fills,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          scrollTrigger: { trigger: list, start: "top 55%", end: "bottom 60%", scrub: 0.3 },
        },
      );
    });
  });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [ref]);

  const current = steps[active];

  return (
    <section
      ref={ref}
      id="process"
      aria-labelledby="process-title"
      className="border-t border-line bg-ink-2"
    >
      <div className="container-page grid gap-12 py-[clamp(5rem,14vh,10rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--header-h)+3rem)] lg:self-start">
          <p className="eyebrow mb-5" data-reveal>
            {eyebrow}
          </p>
          <h2
            id="process-title"
            data-reveal
            className="display-tight text-balance-safe text-[clamp(2.25rem,5.2vw,4.5rem)] font-bold"
          >
            {title}
          </h2>
          <p data-reveal className="mt-6 max-w-lg text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">
            {intro}
          </p>

          {/* Desktop live panel (decorative mirror of the list; hidden from AT). */}
          <div aria-hidden="true" className="mt-12 hidden items-stretch gap-6 lg:flex">
            <div className="relative w-px bg-line-strong">
              <div
                data-progress-fill
                className="absolute inset-0 origin-top bg-accent-soft [[data-motion=reduced]_&]:hidden"
              />
            </div>
            <div>
              <p className="display-tight flex items-baseline gap-3 font-bold">
                <span className="bg-gradient-to-b from-white to-white/20 bg-clip-text text-[clamp(5rem,9vw,8.5rem)] text-transparent">
                  {String(active + 1).padStart(2, "0")}
                </span>
                <span className="text-2xl text-subtle">/ {total}</span>
              </p>
              <p className="mt-2 font-display text-2xl font-semibold">{current.title}</p>
              <p className="mt-1 text-muted">{current.titleTh}</p>
            </div>
          </div>
        </div>

        <ol data-steps className="relative flex flex-col gap-4 lg:gap-0">
          {/* Timeline line (phones/tablets) */}
          <span aria-hidden="true" className="absolute bottom-6 left-[1.1rem] top-6 w-px bg-line-strong lg:hidden" />
          {steps.map((s, i) => (
            <li
              key={s.id}
              id={`step-${s.id}`}
              data-step={i}
              data-active={i === active}
              className="hww-step relative pl-12 lg:pl-0"
            >
              <span
                aria-hidden="true"
                className="hww-step-dot absolute left-[0.8rem] top-8 size-[0.65rem] rounded-full bg-line-strong lg:hidden"
              />
              <div
                data-reveal
                className="hww-step-card w-full rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8 lg:p-10"
              >
                <p className="font-display text-sm font-semibold tracking-[0.2em] text-accent-soft">
                  STEP {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="display-tight mt-4 text-[clamp(1.9rem,3.6vw,3rem)] font-bold">{s.title}</h3>
                <p className="thai-heading mt-1 text-[clamp(1.05rem,1.6vw,1.25rem)] font-semibold text-fg">
                  {s.titleTh}
                </p>
                <p className="mt-4 text-[0.98rem] leading-[1.9] text-muted">{s.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
