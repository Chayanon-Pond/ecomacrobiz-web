import { hero } from "@/content/home";
import { site } from "@/content/site";
import { ScrollScene } from "@/components/motion/ScrollScene";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

export function Hero() {
  const letters = Array.from(site.wordmark);

  return (
    <ScrollScene
      as="section"
      preset="hero"
      ariaLabelledby="hero-title"
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden pt-[var(--header-h)]"
    >
      {/* Ambient light (decorative, transform-only animation) */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div data-hero-light className="absolute inset-0">
          <div className="aurora aurora-a left-[-20%] top-[-25%] size-[90vw] max-h-[60rem] max-w-[60rem] bg-[radial-gradient(circle,rgb(15_52_255/0.55)_0%,rgb(15_52_255/0.12)_40%,transparent_68%)]" />
          <div className="aurora aurora-b right-[-25%] top-[10%] size-[80vw] max-h-[52rem] max-w-[52rem] bg-[radial-gradient(circle,rgb(80_60_255/0.38)_0%,transparent_65%)]" />
          <div className="aurora aurora-c bottom-[-30%] left-[20%] size-[70vw] max-h-[46rem] max-w-[46rem] bg-[radial-gradient(circle,rgb(0_140_255/0.22)_0%,transparent_65%)]" />
        </div>
        {/* fine grid fading out toward the bottom */}
        <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_50%_30%,#000_20%,transparent_75%)]" />
        <div className="grain" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink" />
      </div>

      <div className="container-page flex flex-1 flex-col justify-center gap-[clamp(1.5rem,4vh,3rem)] py-[clamp(2rem,6vh,4rem)]">
        <p
          className="slide-in eyebrow flex items-center gap-3"
          style={{ "--delay": "0.1s" } as React.CSSProperties}
        >
          <span className="inline-block h-px w-10 bg-accent-soft" aria-hidden="true" />
          {hero.eyebrow}
        </p>

        <h1 id="hero-title" className="m-0">
          <span
            data-hero-wordmark
            aria-hidden="true"
            className="display-tight block whitespace-nowrap pb-[0.08em] text-[clamp(2.75rem,13.4vw,15.5rem)] font-bold will-change-transform"
          >
            {letters.map((ch, i) => (
              <span
                key={i}
                className={`wordmark-letter ${i === 0 ? "text-accent" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
              >
                {ch}
              </span>
            ))}
          </span>
          <span className="sr-only">
            {site.name} — {hero.srTitle}
          </span>
        </h1>

        <div
          data-hero-meta
          className="grid gap-8 md:grid-cols-[1fr_minmax(0,26rem)] md:items-end lg:grid-cols-[1fr_minmax(0,30rem)]"
        >
          <p className="display-tight font-display text-[clamp(1.6rem,4.6vw,3.75rem)] font-semibold uppercase">
            {hero.taglineLines.map((line, i) => (
              <span
                key={line}
                className="slide-in block"
                style={{ "--delay": `${0.5 + i * 0.12}s` } as React.CSSProperties}
              >
                {i === 1 ? (
                  <span className="bg-gradient-to-r from-accent-soft via-white to-accent-soft bg-clip-text text-transparent">
                    {line}
                  </span>
                ) : (
                  line
                )}
              </span>
            ))}
          </p>

          <div
            className="flex flex-col gap-6"
          >
            {/* Rendered without an entrance animation: this is the LCP text on phones. */}
            <p className="text-[clamp(1rem,1.6vw,1.125rem)] leading-[1.8] text-muted">
              {hero.intro}
            </p>
            <div
              className="fade-up flex flex-wrap gap-3"
              style={{ "--delay": "0.7s" } as React.CSSProperties}
            >
              <MagneticButton href={site.cta.href} size="lg">
                {site.cta.label}
                <ArrowIcon />
              </MagneticButton>
              <MagneticButton href={hero.secondaryCta.href} variant="ghost" size="lg">
                {hero.secondaryCta.label}
              </MagneticButton>
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="fade-up pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[0.7rem] tracking-[0.3em] text-subtle md:flex"
        style={{ "--delay": "1.4s" } as React.CSSProperties}
      >
        SCROLL
        <span className="relative h-10 w-px overflow-hidden bg-line">
          <span className="absolute inset-x-0 top-0 h-1/2 animate-[scroll-cue_2s_ease-in-out_infinite] bg-fg" />
        </span>
      </div>
    </ScrollScene>
  );
}
