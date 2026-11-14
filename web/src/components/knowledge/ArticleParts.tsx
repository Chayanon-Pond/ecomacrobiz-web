/**
 * Presentational pieces of the article page (/knowledge/[slug]), shared with
 * the admin post preview so the preview is the real public markup. No data
 * fetching and no server-only APIs: safe in server and client components.
 */
import Image from "next/image";
import Link from "next/link";
import type { PostSummary } from "@/content/posts";
import { knowledgePage } from "@/content/knowledge";
import { categoryHref, formatThaiDate, isLocalImage, readingLabel, sameThaiDay } from "./format";

export type ArticleHeaderPost = Pick<
  PostSummary,
  "title" | "excerpt" | "author" | "publishedAt" | "updatedAt" | "readingMinutes" | "categories"
>;

export function ArticleHeader({
  post,
  titleAs: Title = "h1",
}: {
  post: ArticleHeaderPost;
  /** The admin preview renders the title as a <p> (its page already has an h1). */
  titleAs?: "h1" | "p";
}) {
  const primary = post.categories[0];
  const updated = !sameThaiDay(post.publishedAt, post.updatedAt);
  return (
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

        <Title
          id="article-title"
          className="thai-heading max-w-5xl text-balance-safe text-[clamp(2rem,4.8vw,4rem)] font-semibold leading-[1.28]"
        >
          {post.title}
        </Title>
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
  );
}

export function ArticleCover({ cover }: { cover: PostSummary["cover"] }) {
  if (!cover) return null;
  return (
    <figure className="container-page mt-[clamp(2rem,5vh,3.5rem)]">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <Image
          src={cover.src}
          alt={cover.alt}
          width={cover.width}
          height={cover.height}
          // LCP on article pages: <link rel=preload> in <head> + high fetch priority.
          preload
          fetchPriority="high"
          quality={85}
          sizes="(min-width: 1440px) 1344px, 94vw"
          unoptimized={!isLocalImage(cover.src)}
          className="h-auto max-h-[78svh] w-full object-cover"
        />
      </div>
    </figure>
  );
}
