import { Suspense } from "react";
import { getCategories, getPostsPage, type PostsPage } from "@/lib/posts";
import { CategoryFilter } from "./CategoryFilter";
import { Pagination } from "./Pagination";
import { PostCard } from "./PostCard";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{1,4}$/.test(v)) return 1;
  return Math.max(1, Number(v));
}

function PostGrid({
  data,
  base,
  excludeSlug,
  emptyText,
}: {
  data: PostsPage;
  base: string;
  excludeSlug?: string;
  emptyText: string;
}) {
  const posts = data.page === 1 && excludeSlug ? data.posts.filter((p) => p.slug !== excludeSlug) : data.posts;
  if (posts.length === 0) {
    return (
      <div className="mt-12 rounded-[var(--radius-card)] border border-line bg-surface p-10 text-center">
        <p className="text-muted">{data.page > data.totalPages ? "ไม่พบหน้านี้" : emptyText}</p>
        {data.page > 1 && (
          <a href={base} className="mt-4 inline-flex min-h-11 items-center text-accent-soft underline underline-offset-4">
            กลับไปหน้าแรกของรายการ
          </a>
        )}
      </div>
    );
  }
  return (
    <>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {posts.map((post) => (
          <li key={post.slug} className="kn-rise flex">
            <PostCard post={post} />
          </li>
        ))}
      </ul>
      <Pagination base={base} page={data.page} totalPages={data.totalPages} />
    </>
  );
}

/** Reads ?page= (request-time data) — only ever rendered inside <Suspense>. */
async function PagedPostGrid({
  searchParams,
  first,
  category,
  base,
  excludeSlug,
  emptyText,
}: {
  searchParams: SearchParams;
  first: PostsPage;
  category?: string;
  base: string;
  excludeSlug?: string;
  emptyText: string;
}) {
  const page = parsePage((await searchParams).page);
  const data = page === 1 ? first : await getPostsPage({ page, category });
  return <PostGrid data={data} base={base} excludeSlug={excludeSlug} emptyText={emptyText} />;
}

/**
 * Category filter + paginated grid. Page 1 comes from cache and is used as the
 * Suspense fallback, so the prerendered shell already contains the full first
 * page; ?page=N streams in at request time (cacheComponents rule for
 * searchParams).
 */
export async function PostListing({
  searchParams,
  category,
  excludeSlug,
  heading,
  headingId,
}: {
  searchParams: SearchParams;
  category?: string;
  excludeSlug?: string;
  heading: string;
  headingId: string;
}) {
  const [first, all, categories] = await Promise.all([
    getPostsPage({ category }),
    category ? getPostsPage({}) : Promise.resolve(null),
    getCategories(),
  ]);
  const base = category ? `/knowledge/category/${category}` : "/knowledge";
  const emptyText = "ยังไม่มีบทความในหมวดนี้ ติดตามบทความใหม่จากทีม ECOMACROBIZ ได้เร็ว ๆ นี้";
  return (
    <section aria-labelledby={headingId} className="container-page pb-[clamp(5rem,14vh,9rem)]">
      <div className="flex flex-col gap-6 border-t border-line pt-[clamp(2.5rem,6vh,4rem)]">
        <h2 id={headingId} className="thai-heading text-[clamp(1.5rem,3vw,2.25rem)] font-semibold">
          {heading}
        </h2>
        <CategoryFilter categories={categories} active={category ?? null} total={(all ?? first).total} />
      </div>
      <Suspense
        fallback={<PostGrid data={first} base={base} excludeSlug={excludeSlug} emptyText={emptyText} />}
      >
        <PagedPostGrid
          searchParams={searchParams}
          first={first}
          category={category}
          base={base}
          excludeSlug={excludeSlug}
          emptyText={emptyText}
        />
      </Suspense>
    </section>
  );
}
