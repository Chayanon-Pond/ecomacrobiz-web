import { values, vision, mission } from "@/content/purpose";
import { SpotlightCard } from "@/components/ui/SpotlightCard";

/** Values as a numbered spotlight grid, then Vision and Mission panels. */
export function PurposeValues() {
  return (
    <section aria-labelledby="values-title" className="container-page py-[clamp(5rem,14vh,10rem)]">
      <div data-reveal>
        <p className="eyebrow mb-4">{values.eyebrow}</p>
        <h2
          id="values-title"
          className="display-tight text-balance-safe text-[clamp(2.25rem,5.6vw,5rem)] font-bold"
        >
          {values.title}
        </h2>
      </div>

      <ol className="mt-[clamp(3rem,8vh,5rem)] grid gap-4 lg:grid-cols-3 lg:gap-5">
        {values.items.map((v, i) => (
          <li key={v.id} data-reveal className="flex">
            <SpotlightCard className="flex w-full flex-col gap-8 p-7 sm:p-9">
              <div className="relative z-10 flex items-baseline justify-between gap-4">
                <span
                  aria-hidden="true"
                  className="display-tight bg-gradient-to-b from-white to-white/10 bg-clip-text text-[clamp(4rem,7vw,6rem)] font-bold text-transparent"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-accent shadow-[0_0_24px_4px_var(--accent-glow)]"
                />
              </div>
              <div className="relative z-10">
                <h3 className="display-tight text-[clamp(1.75rem,2.6vw,2.4rem)] font-bold uppercase">
                  {v.title}
                </h3>
                {v.paragraphs.map((p, j) => (
                  <p key={j} className="mt-4 text-[0.98rem] leading-[1.9] text-muted">
                    {p}
                  </p>
                ))}
              </div>
            </SpotlightCard>
          </li>
        ))}
      </ol>

      <div className="mt-[clamp(4rem,10vh,7rem)] grid gap-4 lg:grid-cols-2 lg:gap-5">
        {[
          { block: vision, id: "vision-title" },
          { block: mission, id: "mission-title" },
        ].map(({ block, id }, i) => (
          <article
            key={id}
            aria-labelledby={id}
            data-reveal
            className="relative isolate flex flex-col gap-6 overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-br from-surface-2 via-surface to-ink p-7 sm:p-10"
          >
            <div
              aria-hidden="true"
              className={`absolute -z-10 size-[28rem] rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.35),transparent_65%)] ${i === 0 ? "-left-40 -top-40" : "-bottom-48 -right-40"}`}
            />
            <p className="eyebrow">{block.eyebrow}</p>
            <h2
              id={id}
              className="display-tight text-balance-safe text-[clamp(1.9rem,3.6vw,3.25rem)] font-bold"
            >
              {block.title}
            </h2>
            <div className="flex flex-col gap-4">
              {block.paragraphs.map((p, j) => (
                <p key={j} className="text-[0.98rem] leading-[1.9] text-muted">
                  {p}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
