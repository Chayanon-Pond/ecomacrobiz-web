import Link from "next/link";
import { purposeHowWeWork } from "@/content/purpose";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

/** Teaser of the working method; the full process lives on /how-we-work. */
export function PurposeWork() {
  const w = purposeHowWeWork;
  return (
    <section aria-labelledby="purpose-work-title" className="border-t border-line bg-ink-2">
      <div className="container-page py-[clamp(5rem,14vh,10rem)]">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div data-reveal>
            <p className="eyebrow mb-4">{w.eyebrow}</p>
            <h2
              id="purpose-work-title"
              className="display-tight text-balance-safe text-[clamp(2.25rem,5.2vw,4.5rem)] font-bold"
            >
              {w.title}
            </h2>
          </div>
          <div className="flex flex-col gap-5">
            {w.paragraphs.map((p, i) => (
              <p key={i} data-reveal className="text-[clamp(1rem,1.4vw,1.1rem)] leading-[1.9] text-muted">
                {p}
              </p>
            ))}
          </div>
        </div>

        <ol
          aria-label="ขั้นตอนการทำงาน"
          className="mt-[clamp(3rem,8vh,5rem)] grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6"
        >
          {w.phases.map((phase, i) => (
            <li key={phase} data-reveal className="bg-ink">
              <Link
                href={`/how-we-work#step-${phase.toLowerCase().replace(/\s*&\s*/g, "-").replace(/\s+/g, "-")}`}
                data-cursor="hover"
                className="group flex h-full min-h-32 flex-col justify-between gap-6 p-5 transition-colors duration-500 hover:bg-surface focus-visible:bg-surface sm:p-6"
              >
                <span className="font-display text-xs font-semibold tracking-[0.2em] text-accent-soft">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-[clamp(1.05rem,1.6vw,1.3rem)] font-semibold leading-tight text-fg">
                  {phase}
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <div className="mt-10" data-reveal>
          <MagneticButton href={w.cta.href} variant="ghost">
            {w.cta.label}
            <ArrowIcon />
          </MagneticButton>
        </div>
      </div>
    </section>
  );
}
