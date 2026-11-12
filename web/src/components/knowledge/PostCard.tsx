import Image from "next/image";
import type { PostSummary } from "@/lib/posts";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { ArrowIcon } from "@/components/ui/MagneticButton";
import { formatThaiDate, isLocalImage, postHref, readingLabel } from "./format";

/** Grid card: the whole card is one link (no nested interactive elements). */
export function PostCard({
  post,
  headingLevel = "h3",
  sizes = "(min-width: 1280px) 28rem, (min-width: 640px) 46vw, 92vw",
}: {
  post: PostSummary;
  headingLevel?: "h2" | "h3";
  sizes?: string;
}) {
  const H = headingLevel;
  const category = post.categories[0];
  return (
    <SpotlightCard
      href={postHref(post.slug)}
      className="group flex h-full w-full flex-col overflow-hidden transition-[translate] duration-500 ease-out-expo hover:-translate-y-1"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
        {post.cover ? (
          <Image
            src={post.cover.src}
            alt={post.cover.alt}
            fill
            sizes={sizes}
            unoptimized={!isLocalImage(post.cover.src)}
            className="object-cover transition-transform duration-700 ease-out-expo kn-card-img"
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(15_52_255/0.45),transparent_60%)]"
          />
        )}
      </div>
      <div className="relative z-10 flex flex-1 flex-col gap-4 p-6 sm:p-7">
        <p className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent-soft">
          {category ? category.name : "Knowledge"}
        </p>
        <H className="thai-heading text-lg font-semibold text-fg sm:text-xl">{post.title}</H>
        <p className="line-clamp-3 text-[0.95rem] leading-[1.8] text-muted">{post.excerpt}</p>
        <p className="mt-auto flex items-center justify-between gap-4 pt-2 text-sm text-subtle">
          <span>
            <time dateTime={post.publishedAt}>{formatThaiDate(post.publishedAt)}</time>
            <span aria-hidden="true"> · </span>
            {readingLabel(post.readingMinutes)}
          </span>
          <ArrowIcon className="size-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
        </p>
      </div>
    </SpotlightCard>
  );
}
