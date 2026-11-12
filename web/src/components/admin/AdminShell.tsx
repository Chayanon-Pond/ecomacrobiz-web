"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { SessionProvider, useAdmin } from "./SessionProvider";
import { ToastProvider } from "./Toast";

const NAV = [
  { href: "/admin", label: "ภาพรวม", en: "Dashboard" },
  { href: "/admin/posts", label: "บทความ", en: "Posts" },
  { href: "/admin/leads", label: "รายชื่อผู้ติดต่อ", en: "Leads" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <div className="adm-root">
          <Guard>{children}</Guard>
        </div>
      </ToastProvider>
    </SessionProvider>
  );
}

export function Spinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted" role="status">
      <span className="adm-spinner" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function Guard({ children }: { children: ReactNode }) {
  const { status } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (status === "anon" && !isLogin) {
      const next = pathname && pathname !== "/admin" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/admin/login${next}`);
    }
  }, [status, isLogin, pathname, router]);

  if (isLogin) return <>{children}</>;
  if (status !== "authed") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label={status === "anon" ? "กำลังพาไปหน้าเข้าสู่ระบบ…" : "กำลังตรวจสอบสิทธิ์…"} />
      </div>
    );
  }
  return <Chrome>{children}</Chrome>;
}

function Chrome({ children }: { children: ReactNode }) {
  const { user, logout } = useAdmin();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  const active = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-ink-2 md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:px-5 md:py-6">
          <Link href="/admin" className="flex items-center gap-2 no-underline">
            <LogoMark className="h-5 w-auto" />
            <span className="font-display text-sm font-semibold tracking-wide">ECOMACROBIZ</span>
            <span className="adm-badge">Admin</span>
          </Link>
          <button
            type="button"
            className="adm-btn adm-btn-sm md:hidden"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await logout();
            }}
          >
            ออกจากระบบ
          </button>
        </div>
        <nav aria-label="เมนูผู้ดูแล" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-0">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="adm-nav-link"
              aria-current={active(n.href) ? "page" : undefined}
            >
              <span>{n.label}</span>
              <span className="hidden text-xs text-subtle md:inline">{n.en}</span>
            </Link>
          ))}
          <a href="/" target="_blank" rel="noopener" className="adm-nav-link">
            ดูหน้าเว็บไซต์ <span className="hidden text-xs text-subtle md:inline">View site ↗</span>
          </a>
        </nav>
        <div className="hidden px-5 md:absolute md:bottom-6 md:block md:w-60">
          <p className="truncate text-sm">{user?.name || user?.email}</p>
          <p className="mb-3 truncate text-xs text-subtle">{user?.email}</p>
          <button
            type="button"
            className="adm-btn adm-btn-sm w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await logout();
            }}
          >
            ออกจากระบบ (Logout)
          </button>
        </div>
      </aside>
      <main id="admin-main" className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold thai-heading">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
