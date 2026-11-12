import { beliefs } from "@/content/purpose";

/**
 * "What we believe": the four statements stack as sticky cards (pure CSS
 * sticky, smooth on iOS). Heading column stays pinned on large screens.
 */
export function PurposeBeliefs() {
  const total = String(beliefs.statements.length).padStart(2, "0");
  return (
    <section
      aria-labelledby="beliefs-title"
      className="container-page grid gap-12 py-[clamp(5rem,14vh,10rem)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16"
    >
      <div className="lg:sticky lg:top-[calc(var(--header-h)+3rem)] lg:self-start">
        <p className="eyebrow mb-5" data-reveal>
          {beliefs.eyebrow}
        </p>
        <h2
          id="beliefs-title"
          data-reveal
          className="display-tight text-balance-safe text-[clamp(2.25rem,5.4vw,4.75rem)] font-bold"
        >
          {beliefs.title}
        </h2>
        <p data-reveal className="mt-8 max-w-xl text-[clamp(1rem,1.4vw,1.15rem)] leading-[1.9] text-muted">
          {beliefs.intro}
        </p>
      </div>

      <div>
        <ol className="flex flex-col gap-5 pb-[4vh]">
          {beliefs.statements.map((s, i) => (
            <li
              key={s}
              className="sticky"
              style={{ top: `calc(var(--header-h) + 1.5rem + ${i * 1.25}rem)` }}
            >
              <div className="relative flex min-h-[15rem] flex-col justify-between gap-8 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-7 shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.9)] sm:min-h-[17rem] sm:p-10">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.28),transparent_65%)]"
                />
                <span className="relative font-display text-sm font-semibold tracking-[0.2em] text-accent-soft">
                  {String(i + 1).padStart(2, "0")} / {total}
                </span>
                <p className="thai-heading relative text-[clamp(1.25rem,2.4vw,2rem)] font-semibold text-fg">
                  {s}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col gap-6">
          <ul aria-label="ปัจจัยที่เราพิจารณาก่อนพัฒนา Solution" className="flex flex-wrap gap-2">
            {beliefs.factors.map((f) => (
              <li
                key={f}
                data-reveal
                className="rounded-full border border-accent/50 bg-accent/10 px-4 py-1.5 font-display text-sm font-medium text-accent-soft"
              >
                {f}
              </li>
            ))}
          </ul>
          {beliefs.closing.map((p, i) => (
            <p key={i} data-reveal className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
