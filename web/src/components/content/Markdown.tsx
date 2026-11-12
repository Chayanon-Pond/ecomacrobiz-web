/**
 * Shared Markdown renderer (server or client). Used by the article page and
 * the admin preview so both render identically.
 *
 * - GFM (tables, strikethrough, task lists, autolinks) via remark-gfm.
 * - Raw HTML is NOT rendered (react-markdown default) -> safe for admin input.
 * - Headings get deterministic ids (Thai-safe) so the TOC can link to them;
 *   `extractHeadings()` uses the same slugger and ordering.
 * - Image dimensions convention: `![alt](src "1200x800")` or
 *   `![alt](src "1200x800 Caption text")` -> rendered with next/image (no CLS).
 *   Images without dimensions fall back to a lazy <img>.
 */
import Image from "next/image";
import Link from "next/link";
import { isOptimizableImage } from "@/lib/media";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./prose.css";

export type Heading = { depth: number; text: string; id: string };

/** Thai-safe slug: keeps Thai/Latin letters, digits and marks; spaces -> "-". */
export function slugifyHeading(text: string): string {
  const s = text
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "section";
}

function createSlugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/** Strip inline markdown so heading text matches the rendered text. */
function plainInline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

/** ATX headings (`## Title`) outside code fences, in document order. */
export function extractHeadings(markdown: string, depths: number[] = [2, 3]): Heading[] {
  const slug = createSlugger();
  const out: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!m) continue;
    const depth = m[1].length;
    const text = plainInline(m[2]);
    const id = slug(text);
    if (depths.includes(depth)) out.push({ depth, text, id });
  }
  return out;
}

/* ---- minimal rehype plugin: assign heading ids (no extra deps) ---- */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function hastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const slug = createSlugger();
    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName && /^h[1-6]$/.test(node.tagName)) {
        node.properties = { ...(node.properties ?? {}), id: slug(hastText(node).trim()) };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const DIM_RE = /^(\d{2,5})x(\d{2,5})(?:\s+(.+))?$/;

const components: Components = {
  a({ href = "", children, node: _node, ...rest }) {
    void _node;
    const external = /^https?:\/\//.test(href) && !href.includes("ecomacrobiz.com");
    if (!external && href.startsWith("/")) {
      return (
        <Link href={href} {...rest}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  },
  img({ src, alt = "", title }) {
    if (typeof src !== "string" || !src) return null;
    const m = title ? DIM_RE.exec(title) : null;
    if (m) {
      const [, w, h, caption] = m;
      return (
        <span className="prose-figure">
          <Image
            src={src}
            alt={alt}
            width={Number(w)}
            height={Number(h)}
            sizes="(min-width: 1024px) 760px, 100vw"
            // Absolute URLs outside NEXT_PUBLIC_MEDIA_ORIGIN bypass the optimizer.
            unoptimized={!isOptimizableImage(src)}
          />
          {caption ? <span className="prose-caption">{caption}</span> : null}
        </span>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} title={title ?? undefined} loading="lazy" decoding="async" />
    );
  },
  table({ children }) {
    return (
      <div className="prose-table" role="region" aria-label="ตาราง" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
};

export function Markdown({ markdown, className = "prose-article" }: { markdown: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
