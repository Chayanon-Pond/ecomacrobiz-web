import { knowledge, type Post as Teaser } from "@/content/home";
import { getPost, getPostsPage } from "@/lib/posts";
import { postHref, readingLabel } from "@/components/knowledge/format";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

const TEASER_COUNT = 4;

/**
 * The curated teasers (content/home.ts) resolved against the live post data,
 * so a teaser never links to an unpublished/renamed post (404): curated
 * entries that still exist keep their label, renamed ones follow the new
 * slug, missing ones are dropped and the newest posts top the list up.
 * Cached readers (tag `posts`) -> revalidated on every post change.
 */
async function resolveTeasers(): Promise<Teaser[]> {
  const picked: Teaser[] = [];
  const curated = await Promise.all(knowledge.posts.map(async (t) => ({ t, post: await getPost(t.slug) })));
  for (const { t, post } of curated) {
    if (!post || picked.some((x) => x.slug === post.slug)) continue;
    picked.push({ ...t, title: post.title, slug: post.slug, readTime: readingLabel(post.readingMinutes) });
  }
  if (picked.length < TEASER_COUNT) {
    const { posts } = await getPostsPage({ page: 1 });
    for (const p of posts) {
      if (picked.length >= TEASER_COUNT) break;
      if (picked.some((x) => x.slug === p.slug)) continue;
      picked.push({
        title: p.title,
        slug: p.slug,
        category: (p.categories[0]?.name ?? "Knowledge").toUpperCase(),
        readTime: readingLabel(p.readingMinutes),
      });
    }
  }
  return picked.slice(0, TEASER_COUNT);
}

export async function Knowledge() {
  const teasers = await resolveTeasers();
  return (
    <section
      aria-labelledby="knowledge-title"
      className="container-page py-[clamp(5rem,14vh,10rem)]"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div data-reveal>
          <p className="eyebrow mb-4">{knowledge.eyebrow}</p>
          <h2
            id="knowledge-title"
            className="display-tight text-[clamp(2.5rem,7vw,6rem)] font-bold"
          >
            {knowledge.title}
          </h2>
        </div>
        <div data-reveal>
          <MagneticButton href={knowledge.cta.href} variant="ghost">
            {knowledge.cta.label}
            <ArrowIcon />
          </MagneticButton>
        </div>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {teasers.map((post) => (
          <li key={post.slug} data-reveal className="flex">
            <SpotlightCard
              href={postHref(post.slug)}
              className="group flex w-full flex-col justify-between gap-10 p-6 transition-[translate] duration-500 ease-out-expo hover:-translate-y-1 sm:p-7"
            >
              <p className="relative z-10 font-display text-[0.7rem] font-semibold tracking-[0.18em] text-accent-soft">
                {post.category}
              </p>
              <div className="relative z-10">
                <h3 className="thai-heading text-lg font-semibold text-fg">{post.title}</h3>
                <p className="mt-4 flex items-center justify-between text-sm text-subtle">
                  {post.readTime}
                  <ArrowIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </p>
              </div>
            </SpotlightCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
