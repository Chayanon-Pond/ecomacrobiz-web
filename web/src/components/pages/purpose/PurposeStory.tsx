import { story, whoWeAre } from "@/content/purpose";
import { segmentWords } from "@/lib/text";
import { ScrubText } from "@/components/motion/ScrubText";

/** Story -> scroll-read manifesto -> disciplines -> who we are. */
export function PurposeStory() {
  return (
    <>
      <section
        aria-labelledby="story-title"
        className="container-page grid gap-8 py-[clamp(5rem,14vh,10rem)] lg:grid-cols-[12rem_1fr] lg:gap-16"
      >
        <h2 id="story-title" className="eyebrow lg:pt-3" data-reveal>
          {story.eyebrow}
        </h2>
        <div className="flex max-w-5xl flex-col gap-[clamp(3rem,8vh,5rem)]">
          <div className="grid gap-6 md:grid-cols-2 md:gap-10">
            {story.paragraphs.map((p, i) => (
              <p
                key={i}
                data-reveal
                className={
                  i === 0
                    ? "text-[clamp(1.05rem,1.6vw,1.25rem)] leading-[1.9] text-fg"
                    : "text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted md:pt-1"
                }
              >
                {p}
              </p>
            ))}
          </div>

          <ScrubText
            segments={segmentWords(story.manifesto)}
            className="thai-heading text-[clamp(1.5rem,3.4vw,3rem)] font-semibold leading-[1.5] text-fg"
          />

          <div className="flex flex-col gap-6">
            <p data-reveal className="max-w-3xl text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">
              {story.connect}
            </p>
            <ul aria-label="ศาสตร์ที่เราเชื่อมเข้าด้วยกัน" className="flex flex-wrap gap-2.5">
              {story.disciplines.map((d) => (
                <li
                  key={d}
                  data-reveal
                  className="rounded-full border border-line-strong bg-surface/60 px-4 py-2 font-display text-sm font-medium tracking-wide text-fg sm:text-base"
                >
                  {d}
                </li>
              ))}
            </ul>
            <p data-reveal className="max-w-3xl font-medium leading-[1.9] text-accent-soft">
              {story.closing}
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="who-title"
        className="border-y border-line bg-ink-2"
      >
        <div className="container-page grid gap-10 py-[clamp(5rem,14vh,10rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+3rem)] lg:self-start">
            <p className="eyebrow mb-5" data-reveal>
              {whoWeAre.eyebrow}
            </p>
            <h2
              id="who-title"
              data-reveal
              className="display-tight text-balance-safe text-[clamp(2.4rem,6vw,5.5rem)] font-bold"
            >
              {whoWeAre.title}
            </h2>
          </div>
          <div className="flex flex-col gap-6 lg:pt-10">
            {whoWeAre.paragraphs.map((p, i) => (
              <p
                key={i}
                data-reveal
                className={
                  i === 0
                    ? "text-[clamp(1.1rem,1.8vw,1.4rem)] font-medium leading-[1.8] text-fg"
                    : "text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted"
                }
              >
                {p}
              </p>
            ))}
            <p
              data-reveal
              className="mt-4 border-l-2 border-accent pl-5 text-[clamp(1rem,1.4vw,1.15rem)] font-medium leading-[1.9] text-fg"
            >
              {whoWeAre.closing}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
