/**
 * Shared JSON-LD builders. Every inner page renders <JsonLd data={...} />
 * with at least a BreadcrumbList. URLs are absolutised against site.url.
 */
import { site } from "@/content/site";

type Json = Record<string, unknown>;

export function absUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${site.url.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function JsonLd({ data }: { data: Json | Json[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export type Crumb = { name: string; path: string };

/** Home is prepended automatically. */
export function breadcrumbJsonLd(crumbs: Crumb[]): Json {
  const all: Crumb[] = [{ name: "หน้าแรก", path: "/" }, ...crumbs];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absUrl(c.path),
    })),
  };
}

export function faqPageJsonLd(items: { question: string; answer: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.answer },
    })),
  };
}

export const organizationRef = {
  "@type": "Organization",
  name: site.name,
  url: site.url,
  logo: { "@type": "ImageObject", url: absUrl("/images/logo.png") },
} as const;

export function blogPostingJsonLd(p: {
  path: string;
  title: string;
  description: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
  section?: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: { "@type": "WebPage", "@id": absUrl(p.path) },
    headline: p.title,
    description: p.description,
    image: p.image ? [absUrl(p.image)] : undefined,
    datePublished: p.datePublished,
    dateModified: p.dateModified ?? p.datePublished,
    author: p.author ? { "@type": "Person", name: p.author } : organizationRef,
    publisher: organizationRef,
    articleSection: p.section,
    inLanguage: "th-TH",
  };
}

export function webPageJsonLd(
  type: "WebPage" | "AboutPage" | "ContactPage" | "CollectionPage",
  p: { path: string; name: string; description: string },
): Json {
  return {
    "@context": "https://schema.org",
    "@type": type,
    url: absUrl(p.path),
    name: p.name,
    description: p.description,
    inLanguage: "th-TH",
    isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
  };
}
