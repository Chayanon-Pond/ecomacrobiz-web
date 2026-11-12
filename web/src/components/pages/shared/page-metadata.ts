import type { Metadata } from "next";
import { site } from "@/content/site";

/**
 * Per-page metadata. Page-level `openGraph` replaces the root one entirely
 * (shallow merge), so every OG field is restated here. Relative URLs are
 * resolved against `metadataBase` from the root layout.
 */
export function pageMetadata(p: {
  path: string;
  title: string;
  description: string;
  image: { src: string; width: number; height: number; alt: string };
}): Metadata {
  const fullTitle = `${p.title} | ${site.name}`;
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: {
      type: "website",
      locale: site.locale,
      siteName: site.name,
      url: p.path,
      title: fullTitle,
      description: p.description,
      images: [{ url: p.image.src, width: p.image.width, height: p.image.height, alt: p.image.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: p.description,
      images: [p.image.src],
    },
  };
}
