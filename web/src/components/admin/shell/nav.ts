import {
  ClipboardList,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/admin/permissions";

export type NavItem = {
  href: string;
  label: string;
  en: string;
  icon: LucideIcon;
  /** Shown when the user has ANY of these (cosmetic; API enforces). Empty = everyone. */
  anyOf: Permission[];
  keywords?: string;
};

export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/admin", label: "ภาพรวม", en: "Dashboard", icon: LayoutDashboard, anyOf: ["posts:read", "leads:read"], keywords: "home หน้าแรก สรุป" },
    ],
  },
  {
    label: "เนื้อหา",
    items: [
      { href: "/admin/posts", label: "บทความ", en: "Posts", icon: FileText, anyOf: ["posts:read"], keywords: "blog knowledge" },
      { href: "/admin/media", label: "คลังสื่อ", en: "Media", icon: ImageIcon, anyOf: ["media:read"], keywords: "รูปภาพ image upload" },
    ],
  },
  {
    label: "การขาย",
    items: [
      { href: "/admin/leads", label: "รายชื่อผู้ติดต่อ", en: "Leads", icon: Users, anyOf: ["leads:read"], keywords: "ลูกค้า contact crm" },
    ],
  },
  {
    label: "ระบบ",
    items: [
      { href: "/admin/users", label: "ผู้ใช้และสิทธิ์", en: "Users", icon: UserCog, anyOf: ["users:read"], keywords: "ทีม team role invite" },
      { href: "/admin/audit", label: "บันทึกกิจกรรม", en: "Audit log", icon: ClipboardList, anyOf: ["audit:read"], keywords: "log ประวัติ history" },
      { href: "/admin/settings", label: "การตั้งค่า", en: "Settings", icon: Settings, anyOf: ["settings:manage"], keywords: "config ระบบ" },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

const SEGMENT_LABEL: Record<string, string> = {
  posts: "บทความ",
  media: "คลังสื่อ",
  leads: "รายชื่อผู้ติดต่อ",
  users: "ผู้ใช้และสิทธิ์",
  audit: "บันทึกกิจกรรม",
  settings: "การตั้งค่า",
  account: "บัญชีของฉัน",
  new: "เขียนใหม่",
};

/** /admin/leads/123 -> [ภาพรวม, รายชื่อผู้ติดต่อ, รายละเอียด] */
export function breadcrumbs(pathname: string): { href: string; label: string }[] {
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const out = [{ href: "/admin", label: "ภาพรวม" }];
  let acc = "/admin";
  for (const p of parts) {
    acc += `/${p}`;
    out.push({ href: acc, label: SEGMENT_LABEL[p] ?? (parts[0] === "posts" ? "แก้ไข" : "รายละเอียด") });
  }
  return out;
}
