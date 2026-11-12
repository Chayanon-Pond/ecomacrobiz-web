import type { Metadata } from "next";
import { site } from "@/content/site";
import { knowledgePage } from "@/content/knowledge";
import { getFeaturedPost, getPostsPage } from "@/lib/posts";
import { JsonLd, absUrl, breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonld";
import { FeaturedPost, KnowledgeHero } from "@/components/knowledge/KnowledgeHero";
import { PostListing } from "@/components/knowledge/PostListing";
import { defaultOgImage, postHref } from "@/components/knowledge/format";
import "@/components/knowledge/knowledge.css";

const fullTitle = `${knowledgePage.seoTitle} | ${site.name}`;

// OG image: the root app/opengraph-image.jpg (file convention) applies.
export const metadata: Metadata = {
  title: knowledgePage.seoTitle,
  description: knowledgePage.seoDescription,
  alternates: { canonical: knowledgePage.path },
  openGraph: {
    type: "website",
    locale: site.locale,
    siteName: site.name,
    url: knowledgePage.path,
    title: fullTitle,
    description: knowledgePage.seoDescription,
    images: [defaultOgImage],
  },
  twitter: { card: "summary_large_image", title: fullTitle, description: knowledgePage.seoDescription },
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [featured, first] = await Promise.all([getFeaturedPost(), getPostsPage({})]);

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: knowledgePage.title, path: knowledgePage.path }]),
          {
            ...webPageJsonLd("CollectionPage", {
              path: knowledgePage.path,
              name: `${knowledgePage.title} — ${knowledgePage.titleTh}`,
              description: knowledgePage.seoDescription,
            }),
            mainEntity: {
              "@type": "Blog",
              name: `${site.name} ${knowledgePage.title}`,
              url: absUrl(knowledgePage.path),
              inLanguage: "th-TH",
              blogPost: first.posts.map((p) => ({
                "@type": "BlogPosting",
                headline: p.title,
                url: absUrl(postHref(p.slug)),
                datePublished: p.publishedAt,
                dateModified: p.updatedAt,
                ...(p.cover ? { image: absUrl(p.cover.src) } : {}),
              })),
            },
          },
        ]}
      />
      <KnowledgeHero
        eyebrow={knowledgePage.eyebrow}
        title={knowledgePage.title}
        srTitle={`${knowledgePage.title} — ${knowledgePage.lead}`}
        lead={knowledgePage.lead}
        intro={knowledgePage.intro}
      />
      {featured && <FeaturedPost post={featured} />}
      <PostListing
        searchParams={searchParams}
        excludeSlug={featured?.slug}
        heading={knowledgePage.listHeading}
        headingId="kn-list-title"
      />
    </>
  );
}
