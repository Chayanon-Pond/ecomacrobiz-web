import { closingCta } from "@/content/home";
import { site, socials } from "@/content/site";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

export function ClosingCta() {
  const line = socials.find((s) => s.id === "line");
  return (
    <section
      aria-labelledby="cta-title"
      className="relative isolate overflow-hidden border-t border-line"
    >
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-full -z-10 size-[min(140vw,80rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.5),transparent_60%)]"
      />
      <div className="container-page flex flex-col items-center py-[clamp(6rem,18vh,12rem)] text-center">
        <p className="eyebrow mb-6" data-reveal>
          {closingCta.eyebrow}
        </p>
        <h2
          id="cta-title"
          data-reveal
          className="display-tight text-[clamp(2.75rem,9vw,8.5rem)] font-bold"
        >
          {closingCta.title[0]}
          <br />
          <span className="text-accent-soft">{closingCta.title[1]}</span>
        </h2>
        <p data-reveal className="mt-8 max-w-2xl text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.9] text-muted">
          {closingCta.body}
        </p>
        <div data-reveal className="mt-10 flex flex-wrap justify-center gap-3">
          <MagneticButton href={site.cta.href} size="lg" strength={18}>
            {site.cta.label}
            <ArrowIcon />
          </MagneticButton>
          {line && (
            <MagneticButton href={line.href} variant="ghost" size="lg" external>
              คุยผ่าน LINE
            </MagneticButton>
          )}
        </div>
      </div>
    </section>
  );
}

