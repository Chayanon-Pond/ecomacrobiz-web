"use client";

/**
 * Live preview with the REAL public article markup: ArticleHeader /
 * ArticleCover (shared with app/(site)/knowledge/[slug]/page.tsx), the shared
 * Markdown renderer + prose.css and the article TOC. Always on the dark site
 * palette, whatever the admin theme. Loaded lazily by the editor page.
 */
import { Component, useDeferredValue, type ReactNode } from "react";
import { extractHeadings, Markdown } from "@/components/content/Markdown";
import { ArticleCover, ArticleHeader } from "@/components/knowledge/ArticleParts";
import { TableOfContents } from "@/components/knowledge/TableOfContents";
import type { Category } from "@/lib/admin/types";
import "@/components/knowledge/knowledge.css";
import type { PostForm } from "./post-form";

class PreviewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <p className="adm-alert m-6" role="alert">
          แสดงตัวอย่างไม่ได้: {this.state.error}
        </p>
      );
    }
    return this.props.children;
  }
}

export default function PostPreview({
  form,
  categories,
  readingMinutes,
  updatedAt,
  publishedAt,
}: {
  form: PostForm;
  categories: Category[];
  readingMinutes: number;
  updatedAt: string;
  publishedAt: string;
}) {
  const body = useDeferredValue(form.body_markdown);
  const headings = extractHeadings(body);
  const showToc = headings.length >= 3;
  const cats = form.categories
    .map((slug) => categories.find((c) => c.slug === slug))
    .filter((c): c is Category => Boolean(c))
    .map((c) => ({ slug: c.slug, name: c.name, nameTh: c.name_th || c.name }));

  return (
    <div className="pe-preview-site">
      <article aria-labelledby="article-title" className="kn-article">
        <ArticleHeader
          titleAs="p"
          post={{
            title: form.title || "ชื่อเรื่องบทความ",
            excerpt: form.excerpt,
            author: form.author || "ECOMACROBIZ",
            publishedAt,
            updatedAt,
            readingMinutes,
            categories: cats,
          }}
        />
        <ArticleCover
          cover={
            form.cover && form.cover.url
              ? { src: form.cover.url, alt: form.cover.alt, width: form.cover.width || 1600, height: form.cover.height || 900 }
              : null
          }
        />
        <div
          className={`container-page mt-[clamp(2.5rem,7vh,5rem)] grid gap-10 pb-[clamp(4rem,10vh,7rem)] ${
            showToc ? "lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16" : ""
          }`}
        >
          {showToc && (
            <aside className="lg:col-start-2 lg:row-start-1">
              <div className="flex flex-col gap-8 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
                <TableOfContents headings={headings} />
              </div>
            </aside>
          )}
          <div className={`min-w-0 lg:row-start-1 ${showToc ? "" : "mx-auto w-full max-w-[68ch]"}`}>
            {body.trim() ? (
              <PreviewBoundary resetKey={body}>
                <Markdown markdown={body} />
              </PreviewBoundary>
            ) : (
              <p className="text-muted">ยังไม่มีเนื้อหา</p>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
