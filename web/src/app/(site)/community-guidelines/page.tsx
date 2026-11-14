import type { Metadata } from "next";
import { defaultOgImage } from "@/components/knowledge/format";
import { site } from "@/content/site";
import { communityGuidelinesMarkdown, communityGuidelinesPage as page } from "@/content/community";
import { JsonLd, breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonld";
import { Markdown } from "@/components/content/Markdown";

export const metadata: Metadata = {
  title: page.seoTitle,
  description: page.seoDescription,
  alternates: { canonical: page.path },
  openGraph: {
    type: "website",
    locale: site.locale,
    siteName: site.name,
    url: page.path,
    title: `${page.seoTitle} | ${site.name}`,
    description: page.seoDescription,
    images: [defaultOgImage],
  },
};

export default function CommunityGuidelinesPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: page.titleTh, path: page.path }]),
          webPageJsonLd("WebPage", {
            path: page.path,
            name: page.titleTh,
            description: page.seoDescription,
          }),
        ]}
      />
      <article aria-labelledby="guidelines-title">
        <header className="relative isolate flex min-h-[clamp(20rem,46svh,28rem)] flex-col justify-start overflow-hidden pt-[calc(var(--header-h)+clamp(3rem,10vh,6rem))]">
          <div
            aria-hidden="true"
            className="absolute -top-1/3 left-1/2 -z-10 size-[min(120vw,60rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.28),transparent_62%)]"
          />
          <div className="container-page">
            <div className="mx-auto max-w-[68ch]">
              <p className="eyebrow mb-5">{page.title.toUpperCase()}</p>
              <h1 id="guidelines-title" className="thai-heading text-[clamp(2.25rem,5vw,3.75rem)] font-semibold">
                {page.titleTh}
              </h1>
              <p className="mt-5 text-sm text-subtle">
                มีผลบังคับใช้ตั้งแต่วันที่{" "}
                <time dateTime={page.effectiveDate}>{page.effectiveDateTh}</time>
              </p>
            </div>
          </div>
        </header>
        <div className="container-page pb-[clamp(5rem,14vh,9rem)] pt-[clamp(2.5rem,6vh,4rem)]">
          <div className="mx-auto max-w-[68ch] border-t border-line pt-[clamp(2rem,5vh,3rem)]">
            <Markdown markdown={communityGuidelinesMarkdown} />
          </div>
        </div>
      </article>
    </>
  );
}
