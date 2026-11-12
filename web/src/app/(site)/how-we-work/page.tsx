import { howWeWorkPage as p, processSteps, faq, allFaqItems } from "@/content/how-we-work";
import { purposeCta } from "@/content/purpose";
import { JsonLd, breadcrumbJsonLd, faqPageJsonLd, webPageJsonLd } from "@/lib/seo/jsonld";
import { segmentWords } from "@/lib/text";
import { pageMetadata } from "@/components/pages/shared/page-metadata";
import { PageCta } from "@/components/pages/shared/PageCta";
import { ScrubText } from "@/components/motion/ScrubText";
import { ProcessTrack } from "@/components/pages/how-we-work/ProcessTrack";
import { FaqTabs } from "@/components/pages/how-we-work/FaqTabs";

export const metadata = pageMetadata({
  path: p.path,
  title: p.seoTitle,
  description: p.seoDescription,
  image: {
    src: "/images/purpose/team-collaboration.webp",
    width: 2000,
    height: 1333,
    alt: "ทีมงานนั่งทำงานร่วมกันรอบโต๊ะ สะท้อนวิธีการทำงานร่วมกับลูกค้า",
  },
});

export default function HowWeWorkPage() {
  const faqItems = allFaqItems();
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: p.titleTh, path: p.path }]),
          webPageJsonLd("WebPage", {
            path: p.path,
            name: `${p.title} — ${p.titleTh}`,
            description: p.seoDescription,
          }),
          faqPageJsonLd(
            // Bullet markers are presentation only; keep plain sentences.
            faqItems.map((q) => ({ question: q.question, answer: q.answer.replace(/^- /gm, "") })),
          ),
        ]}
      />

      <section aria-labelledby="hww-title" className="relative isolate overflow-hidden pt-[var(--header-h)]">
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="aurora aurora-a left-[10%] top-[-40%] size-[90vw] max-h-[58rem] max-w-[58rem] bg-[radial-gradient(circle,rgb(15_52_255/0.48)_0%,rgb(15_52_255/0.1)_42%,transparent_68%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_50%_20%,#000_15%,transparent_70%)]" />
          <div className="grain" />
        </div>
        <div className="container-page flex min-h-[58svh] flex-col justify-end md:min-h-[70svh] gap-[clamp(1.25rem,3vh,2rem)] pb-[clamp(3rem,8vh,5rem)] pt-[clamp(3rem,10vh,7rem)]">
          <p className="slide-in eyebrow flex items-center gap-3" style={{ "--delay": "0.1s" } as React.CSSProperties}>
            <span className="inline-block h-px w-10 bg-accent-soft" aria-hidden="true" />
            {p.eyebrow}
          </p>
          <h1
            id="hww-title"
            className="slide-in display-tight max-w-6xl text-balance-safe text-[clamp(2.75rem,8.4vw,8.5rem)] font-bold"
            style={{ "--delay": "0.25s" } as React.CSSProperties}
          >
            {p.lead}
            <span className="sr-only"> — {p.titleTh}</span>
          </h1>
          <p
            className="fade-up max-w-2xl text-[clamp(1.05rem,1.6vw,1.25rem)] leading-[1.8] text-muted"
            style={{ "--delay": "0.5s" } as React.CSSProperties}
          >
            {p.intro}
          </p>
        </div>
      </section>

      <section aria-label="หลักการทำงาน" className="container-page grid gap-10 pb-[clamp(5rem,12vh,8rem)] lg:grid-cols-[12rem_1fr] lg:gap-16">
        <p className="eyebrow lg:pt-3" aria-hidden="true">
          PRINCIPLE
        </p>
        <div className="flex max-w-5xl flex-col gap-8">
          <ScrubText
            segments={segmentWords(p.principles[0])}
            className="thai-heading text-[clamp(1.4rem,3vw,2.6rem)] font-semibold leading-[1.5] text-fg"
          />
          <p data-reveal className="max-w-3xl text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted md:ml-auto md:max-w-xl">
            {p.principles[1]}
          </p>
        </div>
      </section>

      <ProcessTrack eyebrow={p.processEyebrow} title={p.processTitle} intro={p.processIntro} steps={processSteps} />

      <section
        id="faq"
        aria-labelledby="faq-title"
        className="container-page scroll-mt-[calc(var(--header-h)+1rem)] py-[clamp(5rem,14vh,10rem)]"
      >
        <div className="mb-[clamp(2rem,6vh,3.5rem)] grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div data-reveal>
            <p className="eyebrow mb-4">{p.faqEyebrow}</p>
            <h2 id="faq-title" className="thai-heading text-[clamp(2.25rem,5.6vw,4.75rem)] font-bold">
              {p.faqTitle}
            </h2>
          </div>
          <p data-reveal className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.9] text-muted">
            {p.faqIntro}
          </p>
        </div>
        <FaqTabs categories={faq.categories} />
      </section>

      <PageCta
        id="hww-cta-title"
        eyebrow={purposeCta.eyebrow}
        title={purposeCta.title}
        body={purposeCta.body}
        secondary={{ label: "See Solutions", href: "/solutions" }}
      />
    </>
  );
}
