import { solutionsPage, solutionsHero, chapters, solutionsCta } from "@/content/solutions";
import { JsonLd, breadcrumbJsonLd, webPageJsonLd, absUrl, organizationRef } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/components/pages/shared/page-metadata";
import { PageCta } from "@/components/pages/shared/PageCta";
import { SolutionsHero } from "@/components/pages/solutions/SolutionsHero";
import { SolutionChapter } from "@/components/pages/solutions/SolutionChapter";
import { ChapterIndex } from "@/components/pages/solutions/ChapterIndex";

export const metadata = pageMetadata({
  path: solutionsPage.path,
  title: solutionsPage.seoTitle,
  description: solutionsPage.seoDescription,
  image: solutionsHero.image,
});

const indexItems = chapters.map((c) => ({ id: c.id, index: c.index, label: c.shortTitle }));

export default function SolutionsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: solutionsPage.titleTh, path: solutionsPage.path }]),
          {
            ...webPageJsonLd("WebPage", {
              path: solutionsPage.path,
              name: `${solutionsPage.title} — ${solutionsPage.titleTh}`,
              description: solutionsPage.seoDescription,
            }),
            mainEntity: {
              "@type": "ItemList",
              name: "ECOMACROBIZ Solutions",
              numberOfItems: chapters.length,
              itemListElement: chapters.map((c, i) => ({
                "@type": "ListItem",
                position: i + 1,
                item: {
                  "@type": "Service",
                  "@id": absUrl(`${solutionsPage.path}#${c.id}`),
                  name: c.title,
                  alternateName: c.titleTh,
                  description: c.description,
                  url: absUrl(`${solutionsPage.path}#${c.id}`),
                  image: absUrl(c.image.src),
                  serviceType: c.shortTitle,
                  areaServed: "TH",
                  provider: organizationRef,
                  hasOfferCatalog: {
                    "@type": "OfferCatalog",
                    name: `${c.shortTitle} deliverables`,
                    itemListElement: c.deliverables.map((d) => ({
                      "@type": "Offer",
                      itemOffered: { "@type": "Service", name: d.title, description: d.description },
                    })),
                  },
                },
              })),
            },
          },
        ]}
      />
      <SolutionsHero />

      <div className="relative">
        <div className="sticky top-[var(--header-h)] z-30 lg:hidden">
          <ChapterIndex items={indexItems} variant="chips" containerId="solution-chapters" />
        </div>

        <div className="container-page grid gap-10 pb-[clamp(3rem,8vh,5rem)] pt-[clamp(2rem,6vh,4rem)] lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-[calc(var(--header-h)+3rem)]">
              <ChapterIndex items={indexItems} variant="rail" containerId="solution-chapters" />
            </div>
          </aside>
          <div id="solution-chapters">
            {chapters.map((c) => (
              <SolutionChapter key={c.id} chapter={c} total={chapters.length} />
            ))}
          </div>
        </div>
      </div>

      <PageCta
        id="solutions-cta-title"
        eyebrow={solutionsCta.eyebrow}
        title={solutionsCta.title}
        body={solutionsCta.body}
      />
    </>
  );
}
