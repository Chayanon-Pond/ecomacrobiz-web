import Image from "next/image";
import { sustainability } from "@/content/home";
import { ScrollScene } from "@/components/motion/ScrollScene";

export function Sustainability() {
  const { image } = sustainability;
  return (
    <ScrollScene
      as="section"
      preset="zoom-media"
      ariaLabelledby="sustainability-title"
      className="relative"
    >
      <div
        data-zoom-media
        className="relative h-[70svh] min-h-[26rem] overflow-hidden md:h-[90svh] md:min-h-[34rem]"
      >
        <Image
          src={image.src}
          alt={image.alt}
          fill
          sizes="100vw"
          className="object-cover object-center will-change-transform"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/30 via-transparent to-ink" />
        <div className="container-page absolute inset-x-0 bottom-0 pb-[clamp(2rem,6vh,4rem)]">
          <h2
            id="sustainability-title"
            className="display-tight text-[clamp(2.75rem,9vw,8.5rem)] font-bold"
          >
            {sustainability.title.lead}{" "}
            <span className="text-accent-soft">{sustainability.title.accent}</span>
          </h2>
        </div>
      </div>

      <div className="container-page grid gap-8 py-[clamp(3rem,10vh,7rem)] md:grid-cols-2 md:gap-12 lg:gap-20">
        {sustainability.paragraphs.map((p, i) => (
          <p
            key={i}
            data-reveal
            className={
              i === 0
                ? "text-[clamp(1.15rem,2vw,1.5rem)] font-medium leading-[1.8] text-fg"
                : "text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted md:pt-2"
            }
          >
            {p}
          </p>
        ))}
      </div>
    </ScrollScene>
  );
}
