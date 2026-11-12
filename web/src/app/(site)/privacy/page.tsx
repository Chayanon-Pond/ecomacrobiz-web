import type { Metadata } from "next";
import { defaultOgImage } from "@/components/knowledge/format";
import { site } from "@/content/site";
import { privacyMarkdown, privacyPage } from "@/content/privacy";
import { JsonLd, breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonld";
import { Markdown } from "@/components/content/Markdown";

/*
 * LEGAL REVIEW PENDING: placeholder PDPA policy (see src/content/privacy.ts).
 * Kept out of search results (noindex) until legal approves the text — then
 * remove `robots` below and add /privacy to sitemap.ts (owner: Bob).
 */
export const metadata: Metadata = {
  title: privacyPage.seoTitle,
  description: privacyPage.seoDescription,
  alternates: { canonical: privacyPage.path },
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    locale: site.locale,
    siteName: site.name,
    url: privacyPage.path,
    title: `${privacyPage.seoTitle} | ${site.name}`,
    description: privacyPage.seoDescription,
    images: [defaultOgImage],
  },
};

export default function PrivacyPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: privacyPage.titleTh, path: privacyPage.path }]),
          webPageJsonLd("WebPage", {
            path: privacyPage.path,
            name: privacyPage.titleTh,
            description: privacyPage.seoDescription,
          }),
        ]}
      />
      <article aria-labelledby="privacy-title">
        <header className="relative isolate flex min-h-[clamp(20rem,46svh,28rem)] flex-col justify-start overflow-hidden pt-[calc(var(--header-h)+clamp(3rem,10vh,6rem))]">
          <div
            aria-hidden="true"
            className="absolute -top-1/3 left-1/2 -z-10 size-[min(120vw,60rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.28),transparent_62%)]"
          />
          <div className="container-page">
            <div className="mx-auto max-w-[68ch]">
              <p className="eyebrow mb-5">{privacyPage.title.toUpperCase()}</p>
              <h1 id="privacy-title" className="thai-heading text-[clamp(2.25rem,5vw,3.75rem)] font-semibold">
                {privacyPage.titleTh}
              </h1>
              <p className="mt-5 text-sm text-subtle">
                มีผลบังคับใช้ตั้งแต่วันที่{" "}
                <time dateTime={privacyPage.effectiveDate}>{privacyPage.effectiveDateTh}</time>
              </p>
            </div>
          </div>
        </header>
        <div className="container-page pb-[clamp(5rem,14vh,9rem)] pt-[clamp(2.5rem,6vh,4rem)]">
          <div className="mx-auto max-w-[68ch] border-t border-line pt-[clamp(2rem,5vh,3rem)]">
            <Markdown markdown={privacyMarkdown} />
          </div>
        </div>
      </article>
    </>
  );
}
