"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ListResponse, PostSummary, Lead } from "@/lib/admin/types";
import { PageHeader } from "./AdminShell";
import { errorMessage, useAdmin } from "./SessionProvider";

type Counts = { posts: number; published: number; drafts: number; newLeads: number };

export function Dashboard() {
  const { request, user } = useAdmin();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const total = (path: string, status: string) =>
      request<ListResponse<PostSummary | Lead>>(path, {
        query: { status, per_page: 1, page: 1 },
        signal: ctrl.signal,
      }).then((r) => r.meta.total);
    Promise.all([
      total("posts", "all"),
      total("posts", "published"),
      total("posts", "draft"),
      total("leads", "new"),
    ])
      .then(([posts, published, drafts, newLeads]) => setCounts({ posts, published, drafts, newLeads }))
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request]);

  const cards = [
    { label: "บทความทั้งหมด", en: "All posts", value: counts?.posts, href: "/admin/posts" },
    { label: "เผยแพร่แล้ว", en: "Published", value: counts?.published, href: "/admin/posts?status=published" },
    { label: "ฉบับร่าง", en: "Drafts", value: counts?.drafts, href: "/admin/posts?status=draft" },
    { label: "ผู้ติดต่อใหม่", en: "New leads", value: counts?.newLeads, href: "/admin/leads?status=new" },
  ];

  return (
    <>
      <PageHeader title={`สวัสดี${user?.name ? ` ${user.name}` : ""}`} subtitle="ภาพรวมเนื้อหาและผู้ติดต่อ (Dashboard)" />
      {error ? (
        <p className="adm-alert mb-6" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="adm-card block p-5 no-underline transition-colors hover:border-line-strong">
            <p className="text-sm text-muted">
              {c.label} <span className="text-subtle">· {c.en}</span>
            </p>
            <p className="mt-2 font-display text-3xl font-semibold" aria-live="polite">
              {c.value ?? (error ? "—" : "…")}
            </p>
          </Link>
        ))}
      </div>
      <h2 className="mt-10 mb-3 text-lg font-semibold">ทางลัด (Quick links)</h2>
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/posts/new" className="adm-btn adm-btn-primary">
          + เขียนบทความใหม่
        </Link>
        <Link href="/admin/posts?status=draft" className="adm-btn">
          ฉบับร่างที่ค้างอยู่
        </Link>
        <Link href="/admin/leads?status=new" className="adm-btn">
          ผู้ติดต่อที่ยังไม่ได้ติดต่อกลับ
        </Link>
        <a href="/knowledge" target="_blank" rel="noopener" className="adm-btn">
          ดูหน้า Knowledge ↗
        </a>
      </div>
    </>
  );
}
