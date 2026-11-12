import { galleryPage, galleryHero, galleryImages, galleryGroups, galleryCta } from "@/content/gallery";
import { JsonLd, breadcrumbJsonLd, absUrl, organizationRef } from "@/lib/seo/jsonld";
import { site } from "@/content/site";
import { pageMetadata } from "@/components/pages/shared/page-metadata";
import { PageCta } from "@/components/pages/shared/PageCta";
import { GalleryGrid } from "@/components/pages/gallery/GalleryGrid";

const ogImage = galleryImages.find((i) => i.id === "billboard") ?? galleryImages[0];

export const metadata = pageMetadata({
  path: galleryPage.path,
  title: galleryPage.seoTitle,
  description: galleryPage.seoDescription,
  image: ogImage,
});

const sections = [
  { group: "moodboard" as const, ...galleryGroups.moodboard, rows: [["texture", "iconic", "packaging-mood"]] },
  {
    group: "application" as const,
    ...galleryGroups.application,
    rows: [
      ["store-front", "billboard"],
      ["retail-counter", "digital-touchpoints", "cleansing-oil"],
    ],
  },
];

export default function GalleryPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: galleryPage.titleTh, path: galleryPage.path }]),
          {
            "@context": "https://schema.org",
            "@type": "ImageGallery",
            url: absUrl(galleryPage.path),
            name: `${galleryPage.title} — ${galleryHero.title}`,
            description: galleryPage.seoDescription,
            inLanguage: "th-TH",
            isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
            author: organizationRef,
            about: galleryHero.project,
            associatedMedia: galleryImages.map((img) => ({
              "@type": "ImageObject",
              contentUrl: absUrl(img.src),
              name: img.title,
              caption: img.caption,
              description: img.alt,
              width: img.width,
              height: img.height,
              encodingFormat: "image/webp",
              creator: organizationRef,
            })),
          },
        ]}
      />

      <section aria-labelledby="gallery-title" className="relative isolate overflow-hidden pt-[var(--header-h)]">
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="aurora aurora-b left-[-20%] top-[-30%] size-[80vw] max-h-[52rem] max-w-[52rem] bg-[radial-gradient(circle,rgb(255_200_80/0.12)_0%,transparent_62%)]" />
          <div className="aurora aurora-a right-[-25%] top-[-20%] size-[80vw] max-h-[52rem] max-w-[52rem] bg-[radial-gradient(circle,rgb(15_52_255/0.42)_0%,transparent_66%)]" />
          <div className="grain" />
        </div>
        <div className="container-page flex min-h-[48svh] flex-col justify-end md:min-h-[56svh] gap-[clamp(1.25rem,3vh,2rem)] pb-[clamp(2rem,6vh,4rem)] pt-[clamp(3rem,10vh,7rem)]">
          <p className="slide-in eyebrow flex items-center gap-3" style={{ "--delay": "0.1s" } as React.CSSProperties}>
            <span className="inline-block h-px w-10 bg-accent-soft" aria-hidden="true" />
            {galleryHero.eyebrow}
          </p>
          <h1
            id="gallery-title"
            className="slide-in display-tight max-w-6xl text-balance-safe text-[clamp(3rem,10vw,10rem)] font-bold"
            style={{ "--delay": "0.25s" } as React.CSSProperties}
          >
            {galleryHero.title}
            <span className="sr-only"> — ผลงานออกแบบแบรนด์และแพ็กเกจจิ้งของ ECOMACROBIZ</span>
          </h1>
          <div
            className="fade-up flex flex-col gap-4 border-t border-line pt-6 md:flex-row md:items-end md:justify-between"
            style={{ "--delay": "0.5s" } as React.CSSProperties}
          >
            <p className="font-display text-[clamp(1.1rem,2vw,1.5rem)] font-semibold">
              {galleryHero.subtitle}
              <span className="mt-1 block font-sans text-[clamp(1rem,1.4vw,1.1rem)] font-normal text-muted">
                {galleryHero.subtitleTh}
              </span>
            </p>
            <p className="font-display text-sm font-semibold tracking-[0.18em] text-accent-soft">
              PROJECT · {galleryHero.project}
            </p>
          </div>
        </div>
      </section>

      <GalleryGrid images={galleryImages} sections={sections} />

      <PageCta
        id="gallery-cta-title"
        eyebrow={galleryCta.eyebrow}
        title={galleryCta.title}
        body={galleryCta.body}
        secondary={galleryCta.secondary}
      />
    </>
  );
}
