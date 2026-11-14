/**
 * GET /knowledge/<slug>/og — generated 1200x630 share image for posts that
 * have neither an og_image nor a cover (see generateMetadata in ../page.tsx).
 *
 * A route handler instead of the opengraph-image.tsx convention: file-based
 * metadata always overrides generateMetadata, and posts WITH an image must
 * keep their own og:image.
 * Font: IBM Plex Sans Thai TTF bundled in web/assets/fonts (OFL), read from
 * disk once per process — no network at build or runtime.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cacheLife, cacheTag } from "next/cache";
import { site } from "@/content/site";
import { getPost, normalizeSlug } from "@/lib/posts";
import { OG_SIZE } from "@/lib/seo/og";

let fontsPromise: Promise<{ semibold: Buffer; medium: Buffer }> | null = null;

function loadFonts() {
  fontsPromise ??= Promise.all([
    readFile(join(process.cwd(), "assets/fonts/IBMPlexSansThai-SemiBold.ttf")),
    readFile(join(process.cwd(), "assets/fonts/IBMPlexSansThai-Medium.ttf")),
  ]).then(([semibold, medium]) => ({ semibold, medium }));
  fontsPromise.catch(() => {
    fontsPromise = null; // retry on the next request
  });
  return fontsPromise;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text.trim();
}

async function renderPostOg(slug: string): Promise<Uint8Array | null> {
  "use cache";
  const key = normalizeSlug(slug);
  cacheTag("posts", `post:${key}`);
  const post = await getPost(key);
  if (!post || post.slug !== key) return null;
  cacheLife("days");

  const { semibold, medium } = await loadFonts();
  const title = clip(post.title, 110);
  const category = post.categories[0]?.name ?? "Knowledge";
  const host = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const res = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#050507",
          backgroundImage:
            "radial-gradient(circle at 85% 0%, rgba(15,52,255,0.55), rgba(15,52,255,0) 55%), radial-gradient(circle at 0% 100%, rgba(15,52,255,0.25), rgba(15,52,255,0) 45%)",
          color: "#f5f5f7",
          fontFamily: "IBM Plex Sans Thai",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", position: "relative", width: 52, height: 26 }}>
            <div style={{ position: "absolute", left: 10, top: 0, width: 26, height: 14, background: "#0C0CFF" }} />
            <div style={{ position: "absolute", left: 0, top: 13, width: 13, height: 13, background: "#0C0CFF" }} />
            <div style={{ position: "absolute", left: 24, top: 13, width: 28, height: 13, background: "#0C0CFF" }} />
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>{site.wordmark}</div>
          <div style={{ marginLeft: "auto", fontSize: 22, fontWeight: 500, color: "#7B8FFF", letterSpacing: "0.16em" }}>
            KNOWLEDGE
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: title.length > 70 ? 56 : 66,
            fontWeight: 600,
            lineHeight: 1.4,
            maxWidth: 1040,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24, fontWeight: 500 }}>
          <div
            style={{
              display: "flex",
              padding: "8px 20px",
              borderRadius: 999,
              border: "1px solid rgba(123,143,255,0.6)",
              background: "rgba(15,52,255,0.18)",
              color: "#7B8FFF",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontSize: 20,
            }}
          >
            {category}
          </div>
          <div style={{ display: "flex", color: "#a3a3ad" }}>{host}</div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "IBM Plex Sans Thai", data: semibold, weight: 600, style: "normal" },
        { name: "IBM Plex Sans Thai", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
  return new Uint8Array(await res.arrayBuffer());
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const png = await renderPostOg((await params).slug);
  if (!png) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(png as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
