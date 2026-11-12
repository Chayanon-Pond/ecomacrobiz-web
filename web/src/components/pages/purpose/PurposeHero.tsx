import Image from "next/image";
import { purposeHero } from "@/content/purpose";
import { ScrollScene } from "@/components/motion/ScrollScene";

/** Wordmark-scale title, then the team photo opens from inset to full bleed. */
export function PurposeHero() {
  const { image } = purposeHero;
  return (
    <>
      <section
        aria-labelledby="purpose-title"
        className="relative isolate overflow-hidden pt-[var(--header-h)]"
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="aurora aurora-a left-[-25%] top-[-35%] size-[90vw] max-h-[56rem] max-w-[56rem] bg-[radial-gradient(circle,rgb(15_52_255/0.5)_0%,rgb(15_52_255/0.1)_42%,transparent_68%)]" />
          <div className="aurora aurora-b right-[-30%] top-[0%] size-[70vw] max-h-[46rem] max-w-[46rem] bg-[radial-gradient(circle,rgb(80_60_255/0.32)_0%,transparent_65%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_30%_20%,#000_15%,transparent_70%)]" />
          <div className="grain" />
        </div>

        <div className="container-page flex min-h-[58svh] flex-col justify-end md:min-h-[72svh] gap-[clamp(1.5rem,4vh,2.5rem)] pb-[clamp(3rem,8vh,6rem)] pt-[clamp(3rem,10vh,7rem)]">
          <p
            className="slide-in eyebrow flex items-center gap-3"
            style={{ "--delay": "0.1s" } as React.CSSProperties}
          >
            <span className="inline-block h-px w-10 bg-accent-soft" aria-hidden="true" />
            PURPOSE · {purposeHero.eyebrow}
          </p>
          <h1 id="purpose-title" className="m-0">
            <span
              aria-hidden="true"
              className="display-tight block pb-[0.06em] text-[clamp(3.5rem,15vw,15rem)] font-bold"
            >
              {Array.from(purposeHero.title).map((ch, i) =>
                ch === " " ? (
                  " "
                ) : (
                  <span
                    key={i}
                    className={`wordmark-letter ${i === 0 ? "text-accent" : ""}`}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    {ch}
                  </span>
                ),
              )}
            </span>
            <span className="sr-only">
              {purposeHero.title} — เรื่องราว เป้าหมาย และหลักการทำงานของ ECOMACROBIZ
            </span>
          </h1>
          <p
            className="slide-in max-w-4xl font-display text-[clamp(1.4rem,3.4vw,3rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-balance-safe"
            style={{ "--delay": "0.55s" } as React.CSSProperties}
          >
            <span className="bg-gradient-to-r from-white via-white to-accent-soft bg-clip-text text-transparent">
              {purposeHero.tagline}
            </span>
          </p>
        </div>
      </section>

      <ScrollScene preset="zoom-media" className="relative">
        <div
          data-zoom-media
          className="relative h-[56svh] min-h-[20rem] overflow-hidden md:h-[82svh] md:min-h-[30rem]"
        >
          <Image
            src={image.src}
            alt={image.alt}
            fill
            loading="eager"
            sizes="100vw"
            className="object-cover object-center will-change-transform"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-transparent to-ink" />
        </div>
      </ScrollScene>
    </>
  );
}
