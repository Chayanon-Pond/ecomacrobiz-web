import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { site } from "@/content/site";
import { knowledgePage } from "@/content/knowledge";
import { getCategories, getPostsPage } from "@/lib/posts";
import { JsonLd, absUrl, breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonld";
import { KnowledgeHero } from "@/components/knowledge/KnowledgeHero";
import { PostListing } from "@/components/knowledge/PostListing";
import { categoryHref, defaultOgImage, postHref } from "@/components/knowledge/format";
import "@/components/knowledge/knowledge.css";

type Params = Promise<{ category: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.map((c) => ({ category: c.slug }));
}

async function findCategory(slug: string) {
  const categories = await getCategories();
  return categories.find((c) => c.slug === decodeURIComponent(slug)) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const cat = await findCategory((await params).category);
  if (!cat) return { title: "ไม่พบหมวดหมู่", robots: { index: false } };
  const title = `${cat.name} — ${cat.nameTh}`;
  const description = cat.description || `บทความหมวด ${cat.nameTh} จาก ${site.name}`;
  const path = categoryHref(cat.slug);
  return {
    title,
    description,
    alternates: { canonical: path },
    // An empty category is a thin page: keep it reachable but out of the index.
    robots: cat.postCount === 0 ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "website",
      locale: site.locale,
      siteName: site.name,
      url: path,
      title: `${title} | ${site.name}`,
      description,
      images: [defaultOgImage],
    },
    twitter: { card: "summary_large_image", title: `${title} | ${site.name}`, description },
  };
}

async function CategoryView({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const cat = await findCategory((await params).category);
  if (!cat) notFound();
  const first = await getPostsPage({ category: cat.slug });
  const path = categoryHref(cat.slug);

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: knowledgePage.title, path: knowledgePage.path },
            { name: cat.nameTh, path },
          ]),
          {
            ...webPageJsonLd("CollectionPage", {
              path,
              name: `${cat.name} — ${cat.nameTh}`,
              description: cat.description,
            }),
            mainEntity: {
              "@type": "ItemList",
              itemListElement: first.posts.map((p, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: absUrl(postHref(p.slug)),
                name: p.title,
              })),
            },
          },
        ]}
      />
      <KnowledgeHero
        eyebrow={knowledgePage.categoryEyebrow}
        title={cat.name}
        srTitle={`${cat.name} — ${cat.nameTh}`}
        lead={cat.nameTh}
        intro={cat.description}
        size="lg"
      />
      <PostListing
        searchParams={searchParams}
        category={cat.slug}
        heading={`บทความในหมวด ${cat.nameTh}`}
        headingId="kn-list-title"
      />
    </>
  );
}

function CategorySkeleton() {
  return (
    <div aria-hidden="true" className="container-page min-h-[80svh] pt-[calc(var(--header-h)+6rem)]">
      <div className="h-6 w-56 rounded-full bg-surface-2" />
      <div className="mt-8 h-24 w-3/4 max-w-3xl rounded-3xl bg-surface" />
    </div>
  );
}

/* Unknown category -> real 404 before streaming starts (see [slug]/page.tsx). */
export default async function CategoryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  if (!(await findCategory((await params).category))) notFound();
  return (
    <Suspense fallback={<CategorySkeleton />}>
      <CategoryView params={params} searchParams={searchParams} />
    </Suspense>
  );
}
