import { site, socials } from "@/content/site";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

/**
 * Closing call-to-action for inner pages (same visual language as the
 * homepage ClosingCta, but copy is passed in per page).
 */
export function PageCta({
  id,
  eyebrow,
  title,
  body,
  secondary,
}: {
  id: string;
  eyebrow: string;
  title: readonly [string, string] | string[];
  body: string;
  secondary?: { label: string; href: string };
}) {
  const line = socials.find((s) => s.id === "line");
  return (
    <section
      aria-labelledby={id}
      className="relative isolate overflow-hidden border-t border-line"
    >
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-full -z-10 size-[min(140vw,80rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.5),transparent_60%)]"
      />
      <div className="container-page flex flex-col items-center py-[clamp(6rem,18vh,12rem)] text-center">
        <p className="eyebrow mb-6" data-reveal>
          {eyebrow}
        </p>
        <h2
          id={id}
          data-reveal
          className="display-tight text-[clamp(2.75rem,9vw,8.5rem)] font-bold"
        >
          {title[0]}
          <br />
          <span className="text-accent-soft">{title[1]}</span>
        </h2>
        <p
          data-reveal
          className="mt-8 max-w-2xl text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.9] text-muted"
        >
          {body}
        </p>
        <div data-reveal className="mt-10 flex flex-wrap justify-center gap-3">
          <MagneticButton href={site.cta.href} size="lg" strength={18}>
            {site.cta.label}
            <ArrowIcon />
          </MagneticButton>
          {secondary ? (
            <MagneticButton href={secondary.href} variant="ghost" size="lg">
              {secondary.label}
            </MagneticButton>
          ) : (
            line && (
              <MagneticButton href={line.href} variant="ghost" size="lg" external>
                คุยผ่าน LINE
              </MagneticButton>
            )
          )}
        </div>
      </div>
    </section>
  );
}
