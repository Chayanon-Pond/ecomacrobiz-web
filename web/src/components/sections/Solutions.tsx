import Image from "next/image";
import { solutions, type Solution } from "@/content/home";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { ArrowIcon } from "@/components/ui/MagneticButton";

/**
 * Bento layout per breakpoint (by item order 01..04):
 *  - phone  (<768):  single column stack
 *  - tablet (md):    2 cols — 01 tall (2 rows) | 02 / 03, then 04 full width
 *  - desktop(lg+):   12 cols — 01 tall 5 cols | 02 + 03 7 cols, 04 full width
 */
const layout: Record<string, { cell: string; card?: string; media: string }> = {
  "branding-system": {
    cell: "md:row-span-2 lg:col-span-5",
    media: "aspect-[4/3] md:aspect-auto md:min-h-[18rem] md:flex-1",
  },
  "communications-tools-system": {
    cell: "lg:col-span-7",
    media: "",
  },
  "digital-platform": {
    cell: "lg:col-span-7",
    media: "aspect-[16/9] md:aspect-[16/8]",
  },
  "quality-system": {
    cell: "md:col-span-2 lg:col-span-12",
    card: "lg:flex-row",
    media: "aspect-[16/9] lg:aspect-auto lg:w-[45%] lg:shrink-0",
  },
};

function SolutionCard({ item }: { item: Solution }) {
  const l = layout[item.id] ?? { cell: "", media: "" };
  const isWide = item.id === "quality-system";
  return (
    <SpotlightCard
      href={item.href}
      className={`group flex h-full w-full flex-col overflow-hidden transition-[translate,box-shadow] duration-500 ease-out-expo hover:-translate-y-1.5 hover:shadow-[0_30px_80px_-30px_var(--accent-glow)] focus-visible:-translate-y-1.5 ${l.card ?? ""}`}
    >
      <div className={`relative z-10 flex flex-col gap-5 p-6 sm:p-8 ${isWide ? "lg:flex-1 lg:justify-between lg:p-10" : ""}`}>
        <div className="flex items-center justify-between gap-4">
          <span className="font-display text-sm font-semibold tracking-[0.2em] text-accent-soft">
            {item.index}
          </span>
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center rounded-full border border-line-strong text-muted transition-all duration-500 group-hover:rotate-[-45deg] group-hover:border-accent group-hover:bg-accent group-hover:text-white group-focus-visible:border-accent group-focus-visible:bg-accent group-focus-visible:text-white"
          >
            <ArrowIcon />
          </span>
        </div>
        <div>
          <h3 className="display-tight text-[clamp(1.6rem,3vw,2.6rem)] font-bold">
            {item.title}
          </h3>
          <p className="mt-4 text-[0.95rem] leading-[1.85] text-muted">{item.description}</p>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="ขอบเขตงาน">
          {item.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-line px-3 py-1 font-display text-xs font-medium tracking-wide text-muted"
            >
              {tag}
            </li>
          ))}
        </ul>
      </div>

      {item.image && (
        <div className={`relative overflow-hidden ${l.media}`}>
          <Image
            src={item.image.src}
            alt={item.image.alt}
            fill
            sizes={
              isWide
                ? "(min-width: 1024px) 45vw, (min-width: 768px) 92vw, 100vw"
                : "(min-width: 1024px) 50vw, (min-width: 768px) 46vw, 100vw"
            }
            className="object-cover transition-transform duration-[1.2s] ease-out-expo group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface/60 via-transparent to-transparent" />
        </div>
      )}
    </SpotlightCard>
  );
}

export function Solutions() {
  return (
    <section
      id="solutions"
      aria-labelledby="solutions-title"
      className="container-page py-[clamp(5rem,14vh,10rem)]"
    >
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
        <div data-reveal>
          <p className="eyebrow mb-4">{solutions.eyebrow}</p>
          <h2
            id="solutions-title"
            className="display-tight text-balance-safe text-[clamp(2.25rem,5.6vw,5rem)] font-bold"
          >
            {solutions.title}
          </h2>
        </div>
        <p data-reveal className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">
          {solutions.intro}
        </p>
      </div>

      <ul className="mt-[clamp(3rem,8vh,5rem)] grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        {solutions.items.map((item) => (
          <li key={item.id} data-reveal className={`flex ${layout[item.id]?.cell ?? ""}`}>
            <SolutionCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
