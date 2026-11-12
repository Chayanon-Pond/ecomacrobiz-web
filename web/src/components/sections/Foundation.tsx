import { foundation } from "@/content/home";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";
import { SpotlightCard } from "@/components/ui/SpotlightCard";

/**
 * Three pillars as sticky "stacking" cards (pure CSS sticky — smooth on iOS).
 * On large screens the heading column stays pinned beside the stack.
 */
export function Foundation() {
  return (
    <section
      aria-labelledby="foundation-title"
      className="container-page grid gap-12 py-[clamp(5rem,14vh,10rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16"
    >
      <div className="lg:sticky lg:top-[calc(var(--header-h)+3rem)] lg:self-start">
        <p className="eyebrow mb-5" data-reveal>
          {foundation.eyebrow}
        </p>
        <h2
          id="foundation-title"
          data-reveal
          className="display-tight text-balance-safe text-[clamp(2.25rem,5.6vw,5rem)] font-bold"
        >
          {foundation.title}
        </h2>
        <div className="mt-8" data-reveal>
          <MagneticButton href={foundation.cta.href} variant="ghost">
            {foundation.cta.label}
            <ArrowIcon />
          </MagneticButton>
        </div>
      </div>

      <ol className="flex flex-col gap-6 pb-[6vh]">
        {foundation.pillars.map((pillar, i) => (
          <li
            key={pillar.title}
            className="sticky"
            style={{ top: `calc(var(--header-h) + 1.5rem + ${i * 1.5}rem)` }}
          >
            <SpotlightCard className="flex min-h-[20rem] flex-col justify-between gap-10 border border-transparent p-7 shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.9)] sm:min-h-[22rem] sm:p-10">
              <div className="relative z-10 flex items-start justify-between gap-6">
                <span className="font-display text-sm font-semibold tracking-[0.2em] text-accent-soft">
                  {String(i + 1).padStart(2, "0")} / {String(foundation.pillars.length).padStart(2, "0")}
                </span>
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-accent shadow-[0_0_24px_4px_var(--accent-glow)]"
                />
              </div>
              <div className="relative z-10">
                <h3 className="display-tight text-[clamp(1.75rem,3.6vw,3rem)] font-bold">
                  {pillar.title}
                </h3>
                <p className="mt-2 font-display text-[clamp(1rem,1.5vw,1.2rem)] font-medium text-muted">
                  {pillar.subtitle}
                </p>
                <p className="mt-6 max-w-2xl text-[0.98rem] leading-[1.9] text-muted">
                  {pillar.description}
                </p>
              </div>
            </SpotlightCard>
          </li>
        ))}
      </ol>
    </section>
  );
}
