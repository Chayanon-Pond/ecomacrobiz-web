"use client";

import { ExternalLink, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/ui/Logo";
import { Tooltip } from "../ui/Tooltip";
import { useAdmin } from "../SessionProvider";
import { NAV_GROUPS, isActive } from "./nav";
import { useSidebarCollapsed } from "./prefs";

/** Nav list shared by the desktop rail and the mobile drawer. */
export function SidebarNav({ onNavigate, inDrawer }: { onNavigate?: () => void; inDrawer?: boolean }) {
  const pathname = usePathname();
  const { canAny } = useAdmin();
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.anyOf.length || canAny(...i.anyOf)) })).filter(
    (g) => g.items.length,
  );
  return (
    <nav aria-label="เมนูหลัก" className="adm-sb-nav">
      {groups.map((g, gi) => (
        <div key={gi} className="adm-sb-group">
          {g.label ? <p className="adm-sb-group-label">{g.label}</p> : null}
          {g.items.map((item) => {
            const Icon = item.icon;
            const link = (
              <Link
                href={item.href}
                className="adm-sb-link"
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="adm-sb-label">{item.label}</span>
              </Link>
            );
            return inDrawer ? (
              <div key={item.href}>{link}</div>
            ) : (
              <Tooltip key={item.href} content={item.label} side="right" decorative>
                {link}
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  return (
    <aside className="adm-sidebar" aria-label="แถบเมนู">
      <Link href="/admin" className="adm-sb-brand" aria-label="ECOMACROBIZ Admin — หน้าภาพรวม">
        <LogoMark className="h-5 w-auto shrink-0" />
        <span className="adm-sb-brand-text">ECOMACROBIZ</span>
      </Link>
      <SidebarNav />
      <div className="adm-sb-foot">
        <Tooltip content="ดูหน้าเว็บไซต์" side="right" decorative>
          <a href="/" target="_blank" rel="noopener" className="adm-sb-link">
            <ExternalLink size={18} aria-hidden="true" />
            <span className="adm-sb-label">ดูหน้าเว็บไซต์</span>
          </a>
        </Tooltip>
        <Tooltip content={collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"} side="right" decorative>
          <button
            type="button"
            className="adm-sb-link"
            aria-pressed={collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            <span className="adm-sb-label">{collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}</span>
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
