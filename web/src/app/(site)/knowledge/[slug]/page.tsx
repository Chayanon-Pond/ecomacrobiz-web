import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { site } from "@/content/site";
import { bundledPosts } from "@/content/posts";
import { knowledgePage } from "@/content/knowledge";
import { getAllPostSlugs, getPost, getRelatedPosts, normalizeSlug } from "@/lib/posts";
import { JsonLd, absUrl, blogPostingJsonLd, breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { Markdown, extractHeadings } from "@/components/content/Markdown";
import { PageCta } from "@/components/pages/shared/PageCta";
import { PostCard } from "@/components/knowledge/PostCard";
import { ReadingProgress } from "@/components/knowledge/ReadingProgress";
import { ShareButtons } from "@/components/knowledge/ShareButtons";
import { TableOfContents } from "@/components/knowledge/TableOfContents";
import {
  categoryHref,
  formatThaiDate,
  isLocalImage,
  postHref,
  readingLabel,
  sameThaiDay,
} from "@/components/knowledge/format";
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
 * OG image: the post cover (real photo, already 1.6–1.9:1, ≤1920 px) instead
 * of a generated opengraph-image.tsx — ImageResponse needs a Thai font file
 * (IBM Plex Sans Thai TTF) loaded at build time, which would add a network
 * dependency or a binary asset to the repo for little gain.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return { title: "ไม่พบบทความ", robots: { index: false } };
  const path = postHref(post.slug);
  const images = post.cover
    ? [{ url: post.cover.src, width: post.cover.width, height: post.cover.height, alt: post.cover.alt }]
    : undefined;
  return {
    title: post.seoTitle,
    description: post.seoDescription,
    alternates: { canonical: path },
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
      images: images?.map((i) => i.url),
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
  const updated = !sameThaiDay(post.publishedAt, post.updatedAt);

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
            title: post.title,
            description: post.seoDescription,
            image: post.cover?.src,
            datePublished: post.publishedAt,
            dateModified: post.updatedAt,
            author: post.author,
            section: primary?.name,
          }),
        ]}
      />
      <ReadingProgress targetId="article-body" />

      <article aria-labelledby="article-title" className="kn-article">
        <header className="relative isolate overflow-hidden pt-[calc(var(--header-h)+clamp(2rem,7vh,4.5rem))]">
          <div
            aria-hidden="true"
            className="absolute -top-1/3 left-1/2 -z-10 size-[min(120vw,60rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_52_255/0.28),transparent_62%)]"
          />
          <div className="container-page">
            <nav aria-label="เส้นทางนำทาง" className="mb-8">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-subtle">
                <li>
                  <Link href="/" className="hover:text-fg">หน้าแรก</Link>
                </li>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={knowledgePage.path} className="hover:text-fg">{knowledgePage.title}</Link>
                </li>
                {primary && (
                  <>
                    <li aria-hidden="true">/</li>
                    <li>
                      <Link href={categoryHref(primary.slug)} className="hover:text-fg">{primary.nameTh}</Link>
                    </li>
                  </>
                )}
              </ol>
            </nav>

            {post.categories.length > 0 && (
              <ul className="mb-6 flex flex-wrap gap-2" aria-label="หมวดหมู่">
                {post.categories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={categoryHref(c.slug)}
                      className="inline-flex min-h-9 items-center rounded-full border border-accent/50 bg-accent/10 px-3.5 font-display text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent-soft transition-colors hover:border-accent-soft"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <h1
              id="article-title"
              className="thai-heading max-w-5xl text-balance-safe text-[clamp(2rem,4.8vw,4rem)] font-semibold leading-[1.28]"
            >
              {post.title}
            </h1>
            {/* A truncated card excerpt ("…") reads badly as a lead; skip it. */}
            {post.excerpt && !post.excerpt.endsWith("…") && (
              <p className="mt-6 max-w-3xl text-[clamp(1.05rem,1.5vw,1.25rem)] leading-[1.85] text-muted">
                {post.excerpt}
              </p>
            )}

            <dl className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-subtle">
              <div>
                <dt className="sr-only">ผู้เขียน</dt>
                <dd className="flex items-center gap-3 text-fg">
                  <span
                    aria-hidden="true"
                    className="grid size-9 place-items-center rounded-full bg-accent font-display text-sm font-semibold text-white"
                  >
                    {post.author.trim().charAt(0).toUpperCase()}
                  </span>
                  {post.author}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt>เผยแพร่</dt>
                <dd>
                  <time dateTime={post.publishedAt}>{formatThaiDate(post.publishedAt, "long")}</time>
                </dd>
              </div>
              {updated && (
                <div className="flex gap-1.5">
                  <dt>อัปเดต</dt>
                  <dd>
                    <time dateTime={post.updatedAt}>{formatThaiDate(post.updatedAt, "long")}</time>
                  </dd>
                </div>
              )}
              <div>
                <dt className="sr-only">เวลาอ่าน</dt>
                <dd>{readingLabel(post.readingMinutes)}</dd>
              </div>
            </dl>
          </div>
        </header>

        {post.cover && (
          <figure className="container-page mt-[clamp(2rem,5vh,3.5rem)]">
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              <Image
                src={post.cover.src}
                alt={post.cover.alt}
                width={post.cover.width}
                height={post.cover.height}
                priority
                quality={85}
                sizes="(min-width: 1440px) 1344px, 94vw"
                unoptimized={!isLocalImage(post.cover.src)}
                className="h-auto max-h-[78svh] w-full object-cover"
              />
            </div>
          </figure>
        )}

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
