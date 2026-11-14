import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { site } from "@/content/site";
import { bundledPosts } from "@/content/posts";
import { knowledgePage } from "@/content/knowledge";
import { getAllPostSlugs, getPost, getRelatedPosts, normalizeSlug } from "@/lib/posts";
import { JsonLd, absUrl, blogPostingJsonLd, breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { postShareImage } from "@/lib/seo/og";
import { Markdown, extractHeadings } from "@/components/content/Markdown";
import { PageCta } from "@/components/pages/shared/PageCta";
import { PostCard } from "@/components/knowledge/PostCard";
import { ReadingProgress } from "@/components/knowledge/ReadingProgress";
import { ShareButtons } from "@/components/knowledge/ShareButtons";
import { TableOfContents } from "@/components/knowledge/TableOfContents";
import { ArticleCover, ArticleHeader } from "@/components/knowledge/ArticleParts";
import { categoryHref, postHref } from "@/components/knowledge/format";
import "@/components/knowledge/knowledge.css";

type Params = Promise<{ slug: string }>;

/**
 * Canonical slugs only. Legacy (Wix) slugs stay unlisted so they hit the
 * request-time permanentRedirect below; /post/<wix-slug> is already 301'd to
 * the canonical URL by next.config.ts.
 */
export async function generateStaticParams() {
  const slugs = await getAllPostSlugs();
  const legacy = new Set(bundledPosts.flatMap((p) => p.legacySlugs.filter((l) => l !== p.slug)));
  const canonical = slugs.filter((s) => !legacy.has(s));
  return (canonical.length ? canonical : slugs).map((slug) => ({ slug }));
}

/**
 * Unlisted params (unknown or legacy slugs) must finish rendering before the
 * response starts so notFound() yields a real 404 and permanentRedirect() a
 * real redirect, instead of a 200 App Shell with streamed soft-404 content.
 */
export const ensureStatic = "navigation";

/*
 * Share image: og_image override -> cover -> generated /knowledge/<slug>/og
 * (lib/seo/og.ts). canonical_url (absolute) overrides the canonical link;
 * noindex posts get robots noindex,follow (and stay out of the sitemap).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return { title: "ไม่พบบทความ", robots: { index: false } };
  const path = postHref(post.slug);
  const image = postShareImage(post);
  const images = [{ url: image.url, width: image.width, height: image.height, alt: image.alt }];
  return {
    title: post.seoTitle,
    description: post.seoDescription,
    alternates: { canonical: post.canonicalUrl || path },
    robots: post.noindex ? { index: false, follow: true } : undefined,
    authors: [{ name: post.author }],
    openGraph: {
      type: "article",
      locale: site.locale,
      siteName: site.name,
      url: path,
      title: post.seoTitle,
      description: post.seoDescription,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [post.author],
      section: post.categories[0]?.name,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: post.seoTitle,
      description: post.seoDescription,
      images,
    },
  };
}

async function Article({ params }: { params: Params }) {
  const key = normalizeSlug((await params).slug);
  const post = await getPost(key);
  if (!post) notFound();
  if (post.slug !== key) permanentRedirect(postHref(post.slug));

  const related = await getRelatedPosts(post, 3);
  const headings = extractHeadings(post.bodyMarkdown);
  const showToc = headings.length >= 3;
  const path = postHref(post.slug);
  const url = absUrl(path);
  const primary = post.categories[0];

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: knowledgePage.title, path: knowledgePage.path },
            ...(primary ? [{ name: primary.nameTh, path: categoryHref(primary.slug) }] : []),
            { name: post.title, path },
          ]),
          blogPostingJsonLd({
            path,
            canonical: post.canonicalUrl,
            title: post.title,
            description: post.seoDescription,
            image: postShareImage(post),
            datePublished: post.publishedAt,
            dateModified: post.updatedAt,
            author: post.author,
            section: primary?.name,
          }),
        ]}
      />
      <ReadingProgress targetId="article-body" />

      <article aria-labelledby="article-title" className="kn-article">
        <ArticleHeader post={post} />

        <ArticleCover cover={post.cover} />

        <div
          className={`container-page mt-[clamp(2.5rem,7vh,5rem)] grid gap-10 pb-[clamp(4rem,10vh,7rem)] ${
            showToc ? "lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16" : ""
          }`}
        >
          {showToc && (
            <aside className="lg:col-start-2 lg:row-start-1">
              <div className="flex flex-col gap-8 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
                <TableOfContents headings={headings} />
                <div className="hidden lg:block">
                  <ShareButtons url={url} title={post.title} compact />
                </div>
              </div>
            </aside>
          )}

          <div id="article-body" className={`min-w-0 lg:row-start-1 ${showToc ? "" : "mx-auto w-full max-w-[68ch]"}`}>
            <Markdown markdown={post.bodyMarkdown} />
            <footer className="mt-14 flex flex-col gap-8 border-t border-line pt-10">
              <ShareButtons url={url} title={post.title} />
              <Link
                href={knowledgePage.path}
                className="inline-flex min-h-11 w-fit items-center gap-2 text-accent-soft underline-offset-4 hover:underline"
              >
                <span aria-hidden="true">←</span> กลับไปหน้าบทความทั้งหมด
              </Link>
            </footer>
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related-title" className="container-page border-t border-line py-[clamp(4rem,12vh,8rem)]">
          <p className="eyebrow mb-4">KEEP READING</p>
          <h2 id="related-title" className="thai-heading text-[clamp(1.5rem,3vw,2.25rem)] font-semibold">
            บทความที่เกี่ยวข้อง
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {related.map((p) => (
              <li key={p.slug} className="flex">
                <PostCard post={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <PageCta
        id="article-cta-title"
        eyebrow="LET'S TALK"
        title={["Turning direction", "into growth."]}
        body="อยากนำแนวคิดในบทความไปใช้กับธุรกิจของคุณ? เล่าโจทย์ให้เราฟัง แล้วทีม ECOMACROBIZ จะช่วยวางแนวทางที่เหมาะสมและมีเหตุผลรองรับ"
      />
    </>
  );
}

function ArticleSkeleton() {
  return (
    <div aria-hidden="true" className="container-page min-h-[100svh] pt-[calc(var(--header-h)+5rem)]">
      <div className="h-4 w-48 rounded-full bg-surface-2" />
      <div className="mt-10 h-14 w-full max-w-4xl rounded-2xl bg-surface" />
      <div className="mt-4 h-14 w-2/3 max-w-3xl rounded-2xl bg-surface" />
      <div className="mt-12 aspect-[16/9] w-full rounded-[var(--radius-card)] bg-surface" />
    </div>
  );
}

/*
 * Resolve the post BEFORE any Suspense boundary so unknown slugs return a real
 * HTTP 404 (and legacy slugs a real redirect) instead of a streamed soft-404 —
 * once streaming starts the status code is locked at 200. getPost() is cached,
 * so the Article below reuses the same result.
 */
export default async function ArticlePage({ params }: { params: Params }) {
  const key = normalizeSlug((await params).slug);
  const post = await getPost(key);
  if (!post) notFound();
  if (post.slug !== key) permanentRedirect(postHref(post.slug));
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <Article params={params} />
    </Suspense>
  );
}
