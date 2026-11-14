/**
 * Shared JSON-LD builders. Every inner page renders <JsonLd data={...} />
 * with at least a BreadcrumbList. URLs are absolutised against site.url.
 */
import { office, site } from "@/content/site";

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
