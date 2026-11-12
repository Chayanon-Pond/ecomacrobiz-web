import type { Metadata } from "next";
import Link from "next/link";
import { defaultOgImage } from "@/components/knowledge/format";
import { site, socials } from "@/content/site";
import { contactChannelsCopy, contactFaqCopy, contactForm, contactPage, contactSteps } from "@/content/contact";
import { faq } from "@/content/how-we-work";
import { JsonLd, absUrl, breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonld";
import { KnowledgeHero } from "@/components/knowledge/KnowledgeHero";
import { ContactForm } from "@/components/contact/ContactForm";
import { FaqTabs } from "@/components/contact/FaqTabs";
import { SocialIcon } from "@/components/ui/SocialIcon";
import { ArrowIcon } from "@/components/ui/MagneticButton";
import "@/components/contact/contact.css";

const fullTitle = `${contactPage.seoTitle} | ${site.name}`;

export const metadata: Metadata = {
  title: contactPage.seoTitle,
  description: contactPage.seoDescription,
  alternates: { canonical: contactPage.path },
  openGraph: {
    type: "website",
    locale: site.locale,
    siteName: site.name,
    url: contactPage.path,
    title: fullTitle,
    description: contactPage.seoDescription,
    images: [defaultOgImage],
  },
  twitter: { card: "summary_large_image", title: fullTitle, description: contactPage.seoDescription },
};

const channelCard =
  "spotlight group flex min-h-24 items-center gap-5 rounded-[var(--radius-card)] bg-surface p-5 transition-[translate] duration-500 ease-out-expo hover:-translate-y-0.5 sm:p-6";

export default function ContactPage() {
  const line = socials.find((s) => s.id === "line");
  const phoneHref = `tel:${site.contact.phoneE164}`;

  return (
    <>
      {/* FAQPage JSON-LD is emitted on /how-we-work only: the same Q&As appear
          there, and Google asks for a single marked-up instance per site. */}
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: contactPage.titleTh, path: contactPage.path }]),
          {
            ...webPageJsonLd("ContactPage", {
              path: contactPage.path,
              name: `${contactPage.title} — ${contactPage.titleTh}`,
              description: contactPage.seoDescription,
            }),
            mainEntity: {
              "@type": "Organization",
              name: site.name,
              legalName: site.legalName,
              url: site.url,
              logo: absUrl("/images/logo.png"),
              telephone: site.contact.phoneE164,
              sameAs: socials.map((s) => s.href),
              contactPoint: {
                "@type": "ContactPoint",
                telephone: site.contact.phoneE164,
                contactType: "customer service",
                areaServed: "TH",
                availableLanguage: ["th", "en"],
              },
            },
          },
        ]}
      />

      <KnowledgeHero
        headingId="contact-title"
        eyebrow={contactPage.eyebrow}
        title={contactPage.title}
        srTitle={`${contactPage.title} — ${contactPage.titleTh} ${site.name}`}
        lead={contactPage.lead}
        intro={contactPage.intro}
      />

      <section aria-label="ช่องทางติดต่อและแบบฟอร์ม" className="container-page pb-[clamp(5rem,14vh,9rem)]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div className="flex flex-col gap-10 lg:sticky lg:top-[calc(var(--header-h)+2rem)] lg:self-start">
            <div>
              <h2 className="eyebrow mb-5">{contactChannelsCopy.heading}</h2>
              <ul className="flex flex-col gap-3">
                <li>
                  <a href={phoneHref} className={channelCard} data-cursor="hover">
                    <span aria-hidden="true" className="relative z-10 grid size-12 shrink-0 place-items-center rounded-full bg-accent text-white">
                      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                      </svg>
                    </span>
                    <span className="relative z-10 flex min-w-0 flex-1 flex-col">
                      <span className="text-sm text-subtle">{contactChannelsCopy.phone.label}</span>
                      <span className="font-display text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                        {site.contact.phoneDisplay}
                      </span>
                      <span className="text-sm text-muted">{contactChannelsCopy.phone.note}</span>
                    </span>
                    <ArrowIcon className="relative z-10 size-5 shrink-0 text-subtle transition-transform duration-300 group-hover:translate-x-1" />
                  </a>
                </li>
                {line && (
                  <li>
                    <a
                      href={line.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={channelCard}
                      data-cursor="hover"
                      aria-label={`${contactChannelsCopy.line.label} — ${contactChannelsCopy.line.note} (เปิดหน้าต่างใหม่)`}
                    >
                      <span aria-hidden="true" className="relative z-10 grid size-12 shrink-0 place-items-center rounded-full bg-[#06c755] text-white">
                        <SocialIcon id="line" className="size-6" />
                      </span>
                      <span className="relative z-10 flex min-w-0 flex-1 flex-col">
                        <span className="text-sm text-subtle">LINE</span>
                        <span className="font-display text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                          {contactChannelsCopy.line.label}
                        </span>
                        <span className="text-sm text-muted">{contactChannelsCopy.line.note}</span>
                      </span>
                      <ArrowIcon className="relative z-10 size-5 shrink-0 text-subtle transition-transform duration-300 group-hover:translate-x-1" />
                    </a>
                  </li>
                )}
              </ul>
            </div>

            <div>
              <h2 className="eyebrow mb-4">{contactChannelsCopy.socialsHeading}</h2>
              <ul className="flex flex-wrap gap-2">
                {socials
                  .filter((s) => s.id !== "line")
                  .map((s) => (
                    <li key={s.id}>
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-5 text-sm text-muted transition-colors hover:border-fg/50 hover:text-fg"
                      >
                        <SocialIcon id={s.id} className="size-4" />
                        {s.label}
                        <span className="sr-only"> (เปิดหน้าต่างใหม่)</span>
                      </a>
                    </li>
                  ))}
              </ul>
            </div>

            <div className="rounded-[var(--radius-card)] border border-line p-6 sm:p-7">
              <h2 className="eyebrow mb-5">{contactSteps.heading}</h2>
              <ol className="flex flex-col gap-4">
                {contactSteps.steps.map((step, i) => (
                  <li key={step} className="flex gap-4">
                    <span aria-hidden="true" className="font-display text-sm font-semibold tabular-nums text-accent-soft">
                      0{i + 1}
                    </span>
                    <span className="leading-[1.8] text-muted">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-8 lg:p-10">
            <h2 id="contact-form-title" className="thai-heading mb-6 text-[clamp(1.4rem,2.6vw,2rem)] font-semibold">
              {contactForm.heading}
            </h2>
            <ContactForm phoneDisplay={site.contact.phoneDisplay} phoneHref={phoneHref} lineHref={line?.href} />
          </div>
        </div>
      </section>

      <section aria-labelledby="contact-faq-title" className="border-t border-line py-[clamp(5rem,14vh,9rem)]">
        <div className="container-page grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] lg:gap-16">
          <div>
            <p className="eyebrow mb-4">{contactFaqCopy.eyebrow}</p>
            <h2 id="contact-faq-title" className="thai-heading text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold">
              {contactFaqCopy.heading}
            </h2>
            <Link
              href={contactFaqCopy.moreHref}
              className="mt-6 inline-flex min-h-11 items-center gap-2 text-accent-soft underline-offset-4 hover:underline"
            >
              {contactFaqCopy.more}
              <ArrowIcon />
            </Link>
          </div>
          <FaqTabs categories={faq.categories} />
        </div>
      </section>
    </>
  );
}
