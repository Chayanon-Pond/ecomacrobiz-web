import { whoWeAre } from "@/content/home";
import { segmentWords } from "@/lib/text";
import { ScrubText } from "@/components/motion/ScrubText";

export function WhoWeAre() {
  const segments = segmentWords(whoWeAre.statement);

  return (
    <section
      aria-labelledby="who-we-are"
      className="container-page grid gap-8 py-[clamp(5rem,14vh,10rem)] lg:grid-cols-[12rem_1fr] lg:gap-16"
    >
      <h2 id="who-we-are" className="eyebrow lg:pt-4" data-reveal>
        {whoWeAre.eyebrow}
      </h2>
      <div className="flex max-w-5xl flex-col gap-10">
        <ScrubText
          segments={segments}
          className="thai-heading text-[clamp(1.5rem,3.4vw,3rem)] font-semibold leading-[1.5] text-fg"
        />
        <p
          data-reveal
          className="max-w-3xl text-[clamp(1rem,1.4vw,1.15rem)] leading-[1.9] text-muted md:ml-auto md:max-w-xl lg:max-w-2xl"
        >
          {whoWeAre.body}
        </p>
      </div>
    </section>
  );
}
