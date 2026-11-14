"use client";

import { ChevronRight, ExternalLink, LogOut, Menu as MenuIcon, Moon, Search, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { SessionPayload } from "@/lib/admin/types";
import { LogoMark } from "@/components/ui/Logo";
import { SessionProvider, useAdmin } from "../SessionProvider";
import { Avatar } from "../ui/Avatar";
import { RoleBadge } from "../ui/Badge";
import { IconButton } from "../ui/Button";
import { Drawer } from "../ui/Drawer";
import { Menu } from "../ui/Menu";
import { CommandPalette } from "./CommandPalette";
import { breadcrumbs } from "./nav";
import { useTheme } from "./prefs";
import { Sidebar, SidebarNav } from "./Sidebar";

/** Authenticated console chrome. `initial` comes from the server-side /auth/me check. */
export function ConsoleShell({ initial, children }: { initial: SessionPayload; children: ReactNode }) {
  return (
    <SessionProvider initial={initial}>
      <Chrome>{children}</Chrome>
    </SessionProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setNavOpen(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="adm-shell">
      <a
        href="#admin-main"
        className="adm-btn adm-btn-primary fixed left-3 top-3 z-[90] -translate-y-20 focus:translate-y-0"
      >
        ข้ามไปยังเนื้อหา
      </a>
      <Sidebar />
      <div className="adm-main-col">
        <header className="adm-topbar">
          <span className="lg:hidden">
            <IconButton label="เปิดเมนู" tooltip={false} onClick={() => setNavOpen(true)} aria-expanded={navOpen}>
              <MenuIcon size={20} aria-hidden="true" />
            </IconButton>
          </span>
          <Breadcrumbs pathname={pathname} />
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" className="adm-search-btn max-md:hidden" onClick={() => setCmdOpen(true)}>
              <Search size={16} aria-hidden="true" />
              <span>ค้นหาหรือสั่งงาน…</span>
              <kbd className="adm-kbd" aria-hidden="true">
                Ctrl K
              </kbd>
            </button>
            <span className="md:hidden">
              <IconButton label="ค้นหาหรือสั่งงาน" tooltip={false} onClick={() => setCmdOpen(true)}>
                <Search size={19} aria-hidden="true" />
              </IconButton>
            </span>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main id="admin-main" tabIndex={-1} className="adm-main outline-none">
          {children}
        </main>
      </div>

      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        side="left"
        title={
          <span className="flex items-center gap-2">
            <LogoMark className="h-5 w-auto" />
            <span className="font-display text-sm font-semibold tracking-wide">ECOMACROBIZ</span>
          </span>
        }
        className="adm-sidebar-inner"
      >
        <div className="-mx-4 -mt-3">
          <SidebarNav inDrawer onNavigate={() => setNavOpen(false)} />
        </div>
        <a href="/" target="_blank" rel="noopener" className="adm-sb-link mt-2">
          <ExternalLink size={18} aria-hidden="true" />
          <span>ดูหน้าเว็บไซต์</span>
        </a>
      </Drawer>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = breadcrumbs(pathname);
  return (
    <nav aria-label="เส้นทาง" className="adm-crumbs min-w-0">
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.href} className={!last && i < crumbs.length - 2 ? "max-sm:hidden" : undefined}>
              {i > 0 ? <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-subtle" /> : null}
              {last ? <span aria-current="page">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton label={next === "light" ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"} tooltipSide="bottom" onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </IconButton>
  );
}

function UserMenu() {
  const { user, logout } = useAdmin();
  const display = user.name || user.email;
  return (
    <Menu
      label="เมนูผู้ใช้"
      menuClassName="w-64"
      trigger={(p) => (
        <button type="button" className="adm-user-btn" {...p} aria-label={`บัญชีผู้ใช้: ${display}`}>
          <Avatar name={user.name} email={user.email} />
          <span className="hidden min-w-0 text-left leading-tight xl:block">
            <span className="block truncate text-sm font-medium">{display}</span>
          </span>
        </button>
      )}
      items={[
        {
          type: "label",
          label: (
            <span className="block py-1">
              <span className="block truncate text-sm font-medium text-fg">{user.name || "—"}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
              <RoleBadge role={user.role} className="mt-1.5" />
            </span>
          ),
        },
        { type: "separator" },
        { label: "บัญชีของฉัน", icon: <UserRound size={16} aria-hidden="true" />, href: "/admin/account" },
        { label: "ดูหน้าเว็บไซต์", icon: <ExternalLink size={16} aria-hidden="true" />, href: "/", external: true },
        { type: "separator" },
        { label: "ออกจากระบบ", icon: <LogOut size={16} aria-hidden="true" />, danger: true, onSelect: () => void logout() },
      ]}
    />
  );
}
