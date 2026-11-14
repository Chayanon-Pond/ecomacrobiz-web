import "./solutions.css";
import Image from "next/image";
import { solutionsHero, solutionsIntro } from "@/content/solutions";
import { ScrollScene } from "@/components/motion/ScrollScene";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

export function SolutionsHero() {
  const { image } = solutionsHero;
  return (
    <>
      <section
        aria-labelledby="solutions-page-title"
        className="relative isolate overflow-hidden pt-[var(--header-h)]"
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="aurora aurora-a right-[-20%] top-[-30%] size-[85vw] max-h-[54rem] max-w-[54rem] bg-[radial-gradient(circle,rgb(15_52_255/0.5)_0%,rgb(15_52_255/0.1)_42%,transparent_68%)]" />
          <div className="aurora aurora-c bottom-[-40%] left-[-10%] size-[70vw] max-h-[46rem] max-w-[46rem] bg-[radial-gradient(circle,rgb(0_140_255/0.2)_0%,transparent_65%)]" />
          <div className="grain" />
        </div>
        <span
          aria-hidden="true"
          className="sol-outline display-tight pointer-events-none absolute -right-[0.06em] bottom-[-0.12em] select-none text-[clamp(10rem,34vw,30rem)] font-bold leading-none"
        >
          04
        </span>

        <div className="container-page relative flex min-h-[58svh] flex-col justify-end md:min-h-[72svh] gap-[clamp(1.25rem,3vh,2rem)] pb-[clamp(3rem,8vh,6rem)] pt-[clamp(3rem,10vh,7rem)]">
          <p
            className="slide-in eyebrow flex items-center gap-3"
            style={{ "--delay": "0.1s" } as React.CSSProperties}
          >
            <span className="inline-block h-px w-10 bg-accent-soft" aria-hidden="true" />
            {solutionsHero.eyebrow}
          </p>
          <h1
            id="solutions-page-title"
            className="slide-in display-tight max-w-6xl text-balance-safe text-[clamp(3rem,9.5vw,9.5rem)] font-bold"
            style={{ "--delay": "0.25s" } as React.CSSProperties}
          >
            {solutionsHero.title}
            <span className="sr-only"> — โซลูชันด้านแบรนด์ การสื่อสาร ดิจิทัล และระบบคุณภาพ</span>
          </h1>
          <div
            className="fade-up flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
            style={{ "--delay": "0.5s" } as React.CSSProperties}
          >
            <p className="max-w-xl text-[clamp(1.05rem,1.6vw,1.25rem)] leading-[1.8] text-muted">
              {solutionsHero.subtitle}
            </p>
            <MagneticButton href={solutionsHero.cta.href} size="lg">
              {solutionsHero.cta.label}
              <ArrowIcon />
            </MagneticButton>
          </div>
        </div>
      </section>

      <ScrollScene preset="zoom-media" className="relative">
        <div
          data-zoom-media
          className="relative h-[52svh] min-h-[18rem] overflow-hidden md:h-[78svh] md:min-h-[28rem]"
        >
          <Image
            src={image.src}
            alt={image.alt}
            fill
            // Above-the-fold LCP candidate: preload in <head> with high priority.
            preload
            fetchPriority="high"
            sizes="100vw"
            className="object-cover object-center will-change-transform"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/30 via-transparent to-ink" />
        </div>
      </ScrollScene>

      <section aria-labelledby="solutions-intro-title" className="container-page py-[clamp(5rem,14vh,10rem)]">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div data-reveal>
            <p className="eyebrow mb-4">{solutionsIntro.eyebrow}</p>
            <h2
              id="solutions-intro-title"
              className="display-tight text-balance-safe text-[clamp(2.25rem,5.2vw,4.75rem)] font-bold"
            >
              {solutionsIntro.title}
            </h2>
          </div>
          <p data-reveal className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">
            {solutionsIntro.body}
          </p>
        </div>
      </section>
    </>
  );
}
