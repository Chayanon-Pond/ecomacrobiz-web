import { numbers } from "@/content/home";
import { CountUp } from "@/components/motion/CountUp";

export function Numbers() {
  return (
    <section
      aria-labelledby="numbers-title"
      className="container-page py-[clamp(5rem,14vh,10rem)]"
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-16">
        <div data-reveal>
          <p className="eyebrow mb-4">{numbers.eyebrow}</p>
          <h2
            id="numbers-title"
            className="display-tight text-[clamp(2.75rem,8vw,7rem)] font-bold"
          >
            {numbers.title}
          </h2>
        </div>
        <p
          data-reveal
          className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted"
        >
          {numbers.intro}
        </p>
      </div>

      <ul className="mt-[clamp(3rem,8vh,5rem)] grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {numbers.stats.map((stat) => (
          <li
            key={stat.label}
            data-reveal
            className="group relative flex flex-col gap-4 bg-ink p-6 transition-colors duration-500 hover:bg-surface sm:p-8"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />
            <p>
              <CountUp
                value={stat.value}
                className="display-tight text-[clamp(4rem,9vw,7.5rem)] font-bold text-fg"
              />
            </p>
            <p className="font-display text-[0.8rem] font-semibold tracking-[0.18em] text-accent-soft">
              {stat.label}
            </p>
            <p className="text-[0.95rem] leading-[1.85] text-muted">{stat.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
