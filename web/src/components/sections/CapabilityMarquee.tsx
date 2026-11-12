import { capabilities } from "@/content/home";

function Row({
  items,
  reverse,
  duration,
  outlined,
}: {
  items: string[];
  reverse?: boolean;
  duration: string;
  outlined?: boolean;
}) {
  const track = (hidden: boolean) => (
    <ul className="marquee-track" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item} className="flex items-center gap-[var(--gap)]">
          <span
            className={`display-tight whitespace-nowrap text-[clamp(2.25rem,6vw,5.5rem)] font-bold ${
              outlined
                ? "text-transparent [-webkit-text-stroke:1px_rgb(255_255_255/0.35)]"
                : "text-fg"
            }`}
          >
            {item}
          </span>
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-accent" />
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="marquee"
      data-direction={reverse ? "reverse" : undefined}
      style={{ "--duration": duration } as React.CSSProperties}
    >
      {track(false)}
      {track(true)}
    </div>
  );
}

/** Infinite CSS marquee (GPU transform only; static under reduced motion). */
export function CapabilityMarquee() {
  const half = Math.ceil(capabilities.length / 2);
  const rowB = [...capabilities.slice(half), ...capabilities.slice(0, half)];
  return (
    <section aria-label="ขีดความสามารถของเรา" className="flex flex-col gap-4 overflow-hidden border-y border-line py-[clamp(2.5rem,7vh,5rem)]">
      <Row items={capabilities} duration="48s" />
      <Row items={rowB} duration="56s" reverse outlined />
    </section>
  );
}
