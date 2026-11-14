/** JSON-LD shapes (src/lib/seo/jsonld.tsx) and share-image precedence (src/lib/seo/og.ts). */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  absUrl,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  organizationJsonLd,
  websiteJsonLd,
} from "../src/lib/seo/jsonld";
import { OG_SIZE, postShareImage } from "../src/lib/seo/og";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const isAbs = (u: unknown) => typeof u === "string" && /^https?:\/\/[^/]+/.test(u);

/** Every string under a key named url/item/@id/logo.url must be absolute. */
function assertAbsoluteUrls(node: unknown, where = "$") {
  if (Array.isArray(node)) return node.forEach((n, i) => assertAbsoluteUrls(n, `${where}[${i}]`));
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (["url", "item", "@id"].includes(k) && typeof v === "string") assert.ok(isAbs(v), `${where}.${k} not absolute: ${v}`);
    assertAbsoluteUrls(v, `${where}.${k}`);
  }
}

describe("Organization + WebSite", () => {
  const org = organizationJsonLd(["https://www.facebook.com/ecomacrobiz/"]);
  const site = websiteJsonLd();

  test("Organization has name, url, logo ImageObject, @id", () => {
    assert.equal(org["@type"], "Organization");
    assert.ok(org.name && org["@id"]);
    const logo = org.logo as { "@type": string; width: number; height: number };
    assert.equal(logo["@type"], "ImageObject");
    assert.ok(logo.width > 0 && logo.height > 0);
    assertAbsoluteUrls(org);
  });

  test("WebSite has no SearchAction (no site search) and points at the publisher", () => {
    assert.equal(site["@type"], "WebSite");
    assert.equal(site.potentialAction, undefined);
    assert.equal(site.inLanguage, "th-TH");
    assert.deepEqual(site.publisher, { "@id": org["@id"] });
    assertAbsoluteUrls(site);
  });
});

describe("BlogPosting", () => {
  const base = {
    path: "/knowledge/branding-vs-marketing",
    title: "Branding กับ Marketing",
    description: "คำอธิบาย",
    image: { url: "/images/knowledge/x/cover.webp", width: 1600, height: 900 },
    datePublished: "2026-11-01T10:00:00+07:00",
    dateModified: "2026-11-02T03:00:00Z",
    author: "ECOMACROBIZ Team",
    section: "Business Growth",
  };
  const ld = blogPostingJsonLd(base);

  test("required Google fields are present", () => {
    for (const k of ["headline", "description", "image", "datePublished", "dateModified", "author", "publisher", "mainEntityOfPage"]) {
      assert.ok(ld[k] !== undefined && ld[k] !== "", `missing ${k}`);
    }
    assert.equal(ld["@type"], "BlogPosting");
    assert.equal(ld.inLanguage, "th-TH");
    assert.equal(ld.articleSection, "Business Growth");
  });

  test("image is an absolute ImageObject with dimensions", () => {
    const img = ld.image as { "@type": string; url: string; width: number; height: number };
    assert.equal(img["@type"], "ImageObject");
    assert.ok(isAbs(img.url));
    assert.equal(img.width, 1600);
    assert.equal(img.height, 900);
  });

  test("dates are ISO 8601 with timezone", () => {
    assert.match(ld.datePublished as string, ISO);
    assert.match(ld.dateModified as string, ISO);
    assert.equal(ld.datePublished, "2026-11-01T03:00:00.000Z");
  });

  test("publisher is the Organization with a logo; author is a Person", () => {
    const pub = ld.publisher as { "@type": string; logo: { url: string } };
    assert.equal(pub["@type"], "Organization");
    assert.ok(isAbs(pub.logo.url));
    assert.deepEqual(ld.author, { "@type": "Person", name: "ECOMACROBIZ Team" });
  });

  test("all URLs are absolute", () => assertAbsoluteUrls(ld));

  test("mainEntityOfPage follows a canonical override", () => {
    const o = blogPostingJsonLd({ ...base, canonical: "https://medium.com/@x/original" });
    assert.deepEqual(o.mainEntityOfPage, { "@type": "WebPage", "@id": "https://medium.com/@x/original" });
    assert.equal(o.url, absUrl(base.path));
  });

  test("headline is capped at 110 characters", () => {
    const o = blogPostingJsonLd({ ...base, title: "ก".repeat(200) });
    assert.ok(Array.from(o.headline as string).length <= 110);
  });

  test("no author -> Organization; no section -> field omitted", () => {
    const o = blogPostingJsonLd({ ...base, author: undefined, section: undefined });
    assert.equal((o.author as { "@type": string })["@type"], "Organization");
    assert.equal("articleSection" in o, false);
  });
});

describe("BreadcrumbList", () => {
  const ld = breadcrumbJsonLd([
    { name: "Knowledge", path: "/knowledge" },
    { name: "Business Growth", path: "/knowledge/category/business-growth" },
  ]);
  test("starts at home, positions are 1..n, items absolute", () => {
    const items = ld.itemListElement as { position: number; name: string; item: string }[];
    assert.equal(items[0].name, "หน้าแรก");
    assert.deepEqual(
      items.map((i) => i.position),
      [1, 2, 3],
    );
    assertAbsoluteUrls(ld);
  });
});

describe("postShareImage precedence", () => {
  const cover = { src: "/images/c.webp", width: 1600, height: 900, alt: "ปก" };
  const og = { src: "https://media.example/og.png", width: 1200, height: 630, alt: "แชร์" };
  test("og_image override wins", () => {
    assert.equal(postShareImage({ slug: "a", title: "t", cover, ogImage: og }).url, og.src);
  });
  test("then the cover", () => {
    assert.equal(postShareImage({ slug: "a", title: "t", cover, ogImage: null }).url, cover.src);
  });
  test("else the generated card", () => {
    assert.deepEqual(postShareImage({ slug: "a", title: "t", cover: null, ogImage: null }), {
      url: "/knowledge/a/og",
      ...OG_SIZE,
      alt: "t",
    });
  });
});
