import { purposePage, purposeHero, howWeThink, purposeCta } from "@/content/purpose";
import { JsonLd, breadcrumbJsonLd, webPageJsonLd, absUrl } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/components/pages/shared/page-metadata";
import { PageCta } from "@/components/pages/shared/PageCta";
import { PurposeHero } from "@/components/pages/purpose/PurposeHero";
import { PurposeStory } from "@/components/pages/purpose/PurposeStory";
import { PurposeBeliefs } from "@/components/pages/purpose/PurposeBeliefs";
import { PurposeValues } from "@/components/pages/purpose/PurposeValues";
import { PurposeLenses } from "@/components/pages/purpose/PurposeLenses";
import { PurposeWork } from "@/components/pages/purpose/PurposeWork";

export const metadata = pageMetadata({
  path: purposePage.path,
  title: purposePage.seoTitle,
  description: purposePage.seoDescription,
  image: purposeHero.image,
});

export default function PurposePage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: purposePage.titleTh, path: purposePage.path }]),
          {
            ...webPageJsonLd("AboutPage", {
              path: purposePage.path,
              name: `${purposePage.title} — ${purposePage.titleTh}`,
              description: purposePage.seoDescription,
            }),
            primaryImageOfPage: {
              "@type": "ImageObject",
              contentUrl: absUrl(purposeHero.image.src),
              width: purposeHero.image.width,
              height: purposeHero.image.height,
            },
          },
        ]}
      />
      <PurposeHero />
      <PurposeStory />
      <PurposeBeliefs />
      <PurposeValues />
      <PurposeLenses
        eyebrow={howWeThink.eyebrow}
        title={howWeThink.title}
        intro={howWeThink.intro}
        lenses={howWeThink.lenses}
        closing={howWeThink.closing}
      />
      <PurposeWork />
      <PageCta
        id="purpose-cta-title"
        eyebrow={purposeCta.eyebrow}
        title={purposeCta.title}
        body={purposeCta.body}
        secondary={purposeCta.secondary}
      />
    </>
  );
}
