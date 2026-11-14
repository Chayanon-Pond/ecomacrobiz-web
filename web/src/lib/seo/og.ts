/**
 * Share image of a post: explicit og_image (admin override) -> cover ->
 * the generated card at /knowledge/<slug>/og (1200x630, see that route).
 */
import type { PostImage, PostSummary } from "@/content/posts";

export const OG_SIZE = { width: 1200, height: 630 } as const;

export type ShareImage = { url: string; width: number; height: number; alt: string };

export function generatedOgPath(slug: string): string {
  return `/knowledge/${slug}/og`;
}

function fromImage(img: PostImage): ShareImage {
  return { url: img.src, width: img.width, height: img.height, alt: img.alt };
}

export function postShareImage(post: Pick<PostSummary, "slug" | "title" | "cover" | "ogImage">): ShareImage {
  if (post.ogImage) return fromImage(post.ogImage);
  if (post.cover) return fromImage(post.cover);
  return { url: generatedOgPath(post.slug), ...OG_SIZE, alt: post.title };
}
