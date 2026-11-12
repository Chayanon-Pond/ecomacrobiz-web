import Image from "next/image";
import Link from "next/link";
import type { PostSummary } from "@/lib/posts";
import { segmentWords } from "@/lib/text";
import { ScrollScene } from "@/components/motion/ScrollScene";
import { ScrubText } from "@/components/motion/ScrubText";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";
import { categoryHref, formatThaiDate, isLocalImage, postHref, readingLabel } from "./format";

/** Shared ambient background (same language as the homepage/purpose heroes). */
export function HeroLights() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      <div className="aurora aurora-a left-[-25%] top-[-35%] size-[90vw] max-h-[56rem] max-w-[56rem] bg-[radial-gradient(circle,rgb(15_52_255/0.5)_0%,rgb(15_52_255/0.1)_42%,transparent_68%)]" />
      <div className="aurora aurora-b right-[-30%] top-[0%] size-[70vw] max-h-[46rem] max-w-[46rem] bg-[radial-gradient(circle,rgb(80_60_255/0.32)_0%,transparent_65%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_at_30%_20%,#000_15%,transparent_70%)]" />
      <div className="grain" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink" />
    </div>
  );
}

/** Wordmark-scale page title with letter reveal (pure CSS, no JS dependency).
 *  Also used by /contact. */
export function KnowledgeHero({
  eyebrow,
  title,
  srTitle,
  lead,
  intro,
  size = "xl",
  headingId = "knowledge-title",
}: {
  eyebrow: string;
  title: string;
  srTitle: string;
  lead: string;
  intro?: string;
  /** xl = page wordmark, lg = long names (categories) */
  size?: "xl" | "lg";
  headingId?: string;
}) {
  // Letters are inline-blocks (for the reveal); keep each word unbreakable.
  let i = 0;
  const words = title.split(" ").map((word) => Array.from(word).map((ch) => ({ ch, i: i++ })));
  return (
    <section aria-labelledby={headingId} className="relative isolate overflow-hidden pt-[var(--header-h)]">
      <HeroLights />
      <div className="container-page flex min-h-[52svh] flex-col justify-end gap-[clamp(1.25rem,3.5vh,2.25rem)] pb-[clamp(2.5rem,7vh,5rem)] pt-[clamp(3rem,10vh,7rem)]">
        <p
          className="slide-in eyebrow flex items-center gap-3"
          style={{ "--delay": "0.1s" } as React.CSSProperties}
        >
          <span className="inline-block h-px w-10 bg-accent-soft" aria-hidden="true" />
          {eyebrow}
        </p>
        <h1 id={headingId} className="m-0">
          <span
            aria-hidden="true"
            className={`display-tight block pb-[0.06em] font-bold ${
              size === "xl" ? "text-[clamp(3rem,14vw,13.5rem)]" : "text-[clamp(2.5rem,8.5vw,8rem)]"
            }`}
          >
            {words.map((letters, w) => (
              <span key={w}>
                {w > 0 && " "}
                <span className="inline-block whitespace-nowrap">
                  {letters.map(({ ch, i: n }) => (
                    <span
                      key={n}
                      className={`wordmark-letter ${n === 0 ? "text-accent" : ""}`}
                      style={{ "--i": n } as React.CSSProperties}
                    >
                      {ch}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </span>
          <span className="sr-only">{srTitle}</span>
        </h1>
        <p
          className="slide-in thai-heading max-w-4xl text-[clamp(1.25rem,2.6vw,2.25rem)] font-semibold"
          style={{ "--delay": "0.5s" } as React.CSSProperties}
        >
          {lead}
        </p>
        {intro && (
          <p
            className="fade-up max-w-3xl text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.85] text-muted"
            style={{ "--delay": "0.7s" } as React.CSSProperties}
          >
            {intro}
          </p>
        )}
      </div>
    </section>
  );
}

/** Big cover (inset -> full bleed on scroll) + scrubbed headline. */
export function FeaturedPost({ post }: { post: PostSummary }) {
  const category = post.categories[0];
  return (
    <section aria-label={`บทความแนะนำ: ${post.title}`} className="pb-[clamp(4rem,12vh,8rem)]">
      {post.cover && (
        <ScrollScene preset="zoom-media" className="relative">
          <Link href={postHref(post.slug)} tabIndex={-1} aria-hidden="true" className="block">
            <div
              data-zoom-media
              className="relative h-[46svh] min-h-[16rem] overflow-hidden md:h-[78svh] md:min-h-[28rem]"
            >
              <Image
                src={post.cover.src}
                alt={post.cover.alt}
                fill
                priority
                sizes="100vw"
                unoptimized={!isLocalImage(post.cover.src)}
                className="object-cover object-center will-change-transform"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-ink/30 via-transparent to-ink/90" />
            </div>
          </Link>
        </ScrollScene>
      )}

      <div className="container-page relative -mt-[clamp(3rem,10vh,7rem)] grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end">
        <div>
          <p className="eyebrow mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Featured</span>
            {category && (
              <>
                <span aria-hidden="true" className="text-subtle">/</span>
                <Link href={categoryHref(category.slug)} className="underline-offset-4 hover:underline">
                  {category.name}
                </Link>
              </>
            )}
          </p>
          <ScrubText
            as="h2"
            segments={segmentWords(post.title)}
            className="thai-heading max-w-5xl text-[clamp(1.75rem,4.4vw,3.75rem)] font-semibold leading-[1.3]"
          />
        </div>
        <div className="flex flex-col gap-6">
          <p className="text-[clamp(1rem,1.3vw,1.0625rem)] leading-[1.85] text-muted">{post.excerpt}</p>
          <p className="text-sm text-subtle">
            {post.author}
            <span aria-hidden="true"> · </span>
            <time dateTime={post.publishedAt}>{formatThaiDate(post.publishedAt, "long")}</time>
            <span aria-hidden="true"> · </span>
            {readingLabel(post.readingMinutes)}
          </p>
          <div>
            <MagneticButton href={postHref(post.slug)} size="lg" ariaLabel={`อ่านบทความ ${post.title}`}>
              อ่านบทความ
              <ArrowIcon />
            </MagneticButton>
          </div>
        </div>
      </div>
    </section>
  );
}
