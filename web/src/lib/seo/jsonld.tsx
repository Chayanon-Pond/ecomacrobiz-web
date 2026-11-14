/**
 * Shared JSON-LD builders. Every inner page renders <JsonLd data={...} />
 * with at least a BreadcrumbList. URLs are absolutised against site.url.
 */
import { office, site } from "@/content/site";
import type { Comment, Stats } from "@/lib/community/types";
import { DELETED_AUTHOR_NAME } from "@/lib/community/types";

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

export const ORGANIZATION_ID = `${site.url.replace(/\/$/, "")}/#organization`;
export const WEBSITE_ID = `${site.url.replace(/\/$/, "")}/#website`;

const logo = { "@type": "ImageObject", url: absUrl("/images/logo.png"), width: 512, height: 512 } as const;

/** Short reference used inside other nodes (resolves to organizationJsonLd by @id). */
export const organizationRef = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: site.name,
  url: site.url,
  logo,
} as const;

/** The office address (content/site.ts `office`). */
export function postalAddressJsonLd(): Json {
  const a = office.postal;
  return {
    "@type": "PostalAddress",
    streetAddress: a.streetAddress,
    addressLocality: a.addressLocality,
    addressRegion: a.addressRegion,
    postalCode: a.postalCode,
    addressCountry: a.addressCountry,
  };
}

/** Site-wide Organization (one node, referenced elsewhere by ORGANIZATION_ID). */
export function organizationJsonLd(sameAs: string[]): Json {
  return {
    "@context": "https://schema.org",
    ...organizationRef,
    legalName: site.legalName,
    description: site.description,
    telephone: office.phoneE164,
    address: postalAddressJsonLd(),
    areaServed: "TH",
    sameAs,
    contactPoint: {
      "@type": "ContactPoint",
      telephone: office.phoneE164,
      contactType: "customer service",
      availableLanguage: ["th", "en"],
    },
  };
}

export const OFFICE_ID = `${site.url.replace(/\/$/, "")}/contact#office`;

/**
 * The office as a ProfessionalService (rendered on /contact only). Linked to
 * the site-wide Organization by @id instead of restating it. No priceRange,
 * no geo (TODO(geo) in content/site.ts).
 */
export function professionalServiceJsonLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": OFFICE_ID,
    name: office.name,
    url: absUrl("/contact"),
    logo,
    image: absUrl("/opengraph-image.jpg"),
    telephone: office.phoneE164,
    address: postalAddressJsonLd(),
    areaServed: "TH",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [...office.hours.days],
        opens: office.hours.opens,
        closes: office.hours.closes,
      },
    ],
    parentOrganization: { "@id": ORGANIZATION_ID },
  };
}

/** No SearchAction: the site has no search page. */
export function websiteJsonLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: site.name,
    url: site.url,
    description: site.description,
    inLanguage: "th-TH",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export type JsonLdImage = { url: string; width: number; height: number };

export function blogPostingJsonLd(p: {
  path: string;
  /** Canonical URL when overridden (post.canonical_url), else the post URL. */
  canonical?: string;
  title: string;
  description: string;
  image: JsonLdImage;
  datePublished: string;
  dateModified?: string;
  author?: string;
  section?: string;
  /** Live community data (lib/community/server.ts). Omit when the API was unavailable. */
  engagement?: PostEngagement;
}): Json {
  const url = absUrl(p.path);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": p.canonical || url },
    headline: p.title.length > 110 ? `${Array.from(p.title).slice(0, 109).join("")}…` : p.title,
    description: p.description,
    image: { "@type": "ImageObject", url: absUrl(p.image.url), width: p.image.width, height: p.image.height },
    datePublished: toIso(p.datePublished),
    dateModified: toIso(p.dateModified ?? p.datePublished),
    author: p.author ? { "@type": "Person", name: p.author } : organizationRef,
    publisher: organizationRef,
    ...(p.section ? { articleSection: p.section } : {}),
    inLanguage: "th-TH",
    isPartOf: { "@id": WEBSITE_ID },
    ...(p.engagement ? engagementJsonLd(p.engagement, url) : {}),
  };
}

export type PostEngagement = {
  /** Real API counts; null when only the comment list is known. */
  stats: Stats | null;
  /** Total visible comments incl. replies (comments meta comment_count). */
  commentCount: number;
  /** First page as rendered in the HTML (top-level with reply previews). */
  comments: Comment[];
};

const MAX_LD_COMMENTS = 30;

/** Plain text of the server-rendered comment HTML (strong/em/a/br only). */
export function commentPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
}

function commentNode(c: Comment, postUrl: string, budget: { left: number }): Json | null {
  // Only published, non-deleted comments with text are UGC worth describing.
  if (c.status !== "published" || budget.left <= 0) return null;
  const text = commentPlainText(c.body_html);
  if (!text && !c.image) return null;
  budget.left--;
  const replies = (c.replies ?? [])
    .map((r) => commentNode(r, postUrl, budget))
    .filter((n): n is Json => n !== null);
  return {
    "@type": "Comment",
    "@id": `${postUrl}#comment-${c.id}`,
    url: `${postUrl}#comment-${c.id}`,
    text: text || "รูปภาพ",
    dateCreated: toIso(c.created_at),
    ...(c.edited_at ? { dateModified: toIso(c.edited_at) } : {}),
    author: { "@type": "Person", name: c.author?.display_name ?? DELETED_AUTHOR_NAME },
    ...(c.like_count > 0 ? { upvoteCount: c.like_count } : {}),
    ...(c.image ? { image: absUrl(c.image.url) } : {}),
    ...(replies.length ? { comment: replies } : {}),
  };
}

function counter(type: "LikeAction" | "CommentAction" | "ViewAction", n: number): Json {
  return {
    "@type": "InteractionCounter",
    interactionType: `https://schema.org/${type}`,
    userInteractionCount: Math.max(0, Math.floor(n)),
  };
}

/** commentCount, interactionStatistic (real counts only) and the rendered comments. */
export function engagementJsonLd(e: PostEngagement, postUrl: string): Json {
  const budget = { left: MAX_LD_COMMENTS };
  const comments = e.comments
    .map((c) => commentNode(c, postUrl, budget))
    .filter((n): n is Json => n !== null);
  const commentCount = e.stats ? e.stats.comments : e.commentCount;
  return {
    commentCount,
    ...(e.stats
      ? {
          interactionStatistic: [
            counter("LikeAction", e.stats.likes),
            counter("CommentAction", e.stats.comments),
            counter("ViewAction", e.stats.views),
          ],
        }
      : {}),
    ...(comments.length ? { comment: comments } : {}),
  };
}

/** ISO 8601 with timezone (API timestamps already are; this guards bundle data). */
export function toIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
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
    isPartOf: { "@type": "WebSite", "@id": WEBSITE_ID, name: site.name, url: site.url },
  };
}
