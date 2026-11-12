import Image from "next/image";
import Link from "next/link";
import type { SolutionChapter as Chapter } from "@/content/solutions";
import { faq } from "@/content/how-we-work";
import { ScrollScene } from "@/components/motion/ScrollScene";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { ArrowIcon } from "@/components/ui/MagneticButton";

/** One solution chapter: title block + zoom media, scope, deliverables. */
export function SolutionChapter({ chapter, total }: { chapter: Chapter; total: number }) {
  const flip = Number(chapter.index) % 2 === 0;
  const titleId = `${chapter.id}-title`;
  const faqCat = faq.categories.find((c) => c.id === chapter.faqCategory);
  const isLightPlate = chapter.image.plate === "light";

  return (
    <section
      id={chapter.id}
      aria-labelledby={titleId}
      className="sol-chapter border-t border-line py-[clamp(4rem,12vh,8rem)] first:border-t-0 first:pt-0"
    >
      <div className={`grid items-center gap-8 md:grid-cols-2 md:gap-10 lg:gap-14 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}>
        <div className="@container flex flex-col gap-5" data-reveal>
          <p className="flex items-center gap-3 font-display text-sm font-semibold tracking-[0.2em] text-accent-soft">
            <span>{chapter.index}</span>
            <span className="h-px w-10 bg-line-strong" aria-hidden="true" />
            <span className="text-subtle">{String(total).padStart(2, "0")}</span>
          </p>
          <h2
            id={titleId}
            className="display-tight text-balance-safe text-[clamp(1.75rem,11cqi,4.25rem)] font-bold"
          >
            {chapter.title}
          </h2>
          <p className="thai-heading text-[clamp(1.1rem,1.8vw,1.4rem)] font-semibold text-fg">
            {chapter.titleTh}
          </p>
          <p className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">{chapter.pitch}</p>
        </div>

        <ScrollScene preset="zoom-media">
          <div
            data-zoom-media
            className={`relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] md:aspect-[4/5] ${
              isLightPlate
                ? "bg-[radial-gradient(120%_90%_at_50%_10%,#ffffff_0%,#eceef5_55%,#d9dcea_100%)]"
                : "bg-surface"
            }`}
          >
            <Image
              src={chapter.image.src}
              alt={chapter.image.alt}
              fill
              sizes="(min-width: 1024px) 38vw, (min-width: 768px) 46vw, 100vw"
              className={`will-change-transform ${isLightPlate ? "object-contain p-[6%]" : "object-cover"}`}
            />
          </div>
        </ScrollScene>
      </div>

      <div className="mt-[clamp(2.5rem,6vh,4rem)] grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-12">
        <div className="flex flex-col gap-5" data-reveal>
          <p className="eyebrow">ขอบเขตงาน</p>
          <p className="text-[0.98rem] leading-[1.9] text-muted">{chapter.description}</p>
          <ul className="flex flex-wrap gap-2" aria-label={`แท็กของ ${chapter.shortTitle}`}>
            {chapter.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-line px-3 py-1 font-display text-xs font-medium tracking-wide text-muted"
              >
                {tag}
              </li>
            ))}
          </ul>
          {faqCat && (
            <Link
              href={`/how-we-work#faq-${faqCat.id}`}
              data-cursor="hover"
              className="group mt-2 inline-flex min-h-11 w-fit items-center gap-2 font-medium text-accent-soft underline-offset-4 hover:underline"
            >
              คำถามที่พบบ่อย: {faqCat.label}
              <ArrowIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          )}
        </div>

        <ul className="grid gap-3 sm:grid-cols-2" aria-label={`สิ่งที่ส่งมอบใน ${chapter.shortTitle}`}>
          {chapter.deliverables.map((d, i) => (
            <li key={d.title} data-reveal className="flex">
              <SpotlightCard className="flex w-full flex-col gap-3 p-5 sm:p-6">
                <span className="relative z-10 font-display text-xs font-semibold tracking-[0.2em] text-accent-soft">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="relative z-10 font-display text-[1.1rem] font-semibold leading-snug text-fg">
                  {d.title}
                </h3>
                <p className="relative z-10 text-[0.92rem] leading-[1.8] text-muted">{d.description}</p>
              </SpotlightCard>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
