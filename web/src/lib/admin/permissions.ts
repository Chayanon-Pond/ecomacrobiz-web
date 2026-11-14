/**
 * RBAC mirror of api/internal/domain/rbac.go. COSMETIC ONLY: the UI hides
 * menus/buttons the user cannot use; the Go API enforces every permission.
 * Prefer the `permissions` array from /auth/me over ROLE_PERMISSIONS.
 */

export type Role = "owner" | "editor" | "sales" | "viewer";

export type Permission =
  | "posts:read"
  | "posts:write"
  | "posts:publish"
  | "media:read"
  | "media:write"
  | "leads:read"
  | "leads:write"
  | "leads:export"
  | "users:read"
  | "users:manage"
  | "audit:read"
  | "settings:manage";

export const ROLES: Role[] = ["owner", "editor", "sales", "viewer"];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "เจ้าของระบบ",
  editor: "บรรณาธิการ",
  sales: "ฝ่ายขาย",
  viewer: "ผู้ชม",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: "จัดการได้ทุกส่วน รวมถึงผู้ใช้ บันทึกกิจกรรม และการตั้งค่า",
  editor: "เขียน แก้ไข เผยแพร่บทความ และจัดการคลังสื่อ",
  sales: "ดูและจัดการรายชื่อผู้ติดต่อ (Leads) รวมถึงส่งออก CSV",
  viewer: "ดูข้อมูลบทความ คลังสื่อ และ Leads ได้อย่างเดียว",
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "posts:read",
    "posts:write",
    "posts:publish",
    "media:read",
    "media:write",
    "leads:read",
    "leads:write",
    "leads:export",
    "users:read",
    "users:manage",
    "audit:read",
    "settings:manage",
  ],
  editor: ["posts:read", "posts:write", "posts:publish", "media:read", "media:write"],
  sales: ["leads:read", "leads:write", "leads:export"],
  viewer: ["posts:read", "media:read", "leads:read"],
};

export function can(perms: readonly Permission[] | null | undefined, ...need: Permission[]): boolean {
  if (!perms) return false;
  return need.every((p) => perms.includes(p));
}

export function canAny(perms: readonly Permission[] | null | undefined, ...need: Permission[]): boolean {
  if (!perms) return false;
  return need.some((p) => perms.includes(p));
}

/** Audit action -> Thai label (keep in sync with api/internal/domain/audit.go). */
export const AUDIT_ACTIONS: Record<string, string> = {
  "auth.login": "เข้าสู่ระบบ",
  "auth.login_failed": "เข้าสู่ระบบไม่สำเร็จ",
  "auth.logout": "ออกจากระบบ",
  "auth.password_change": "เปลี่ยนรหัสผ่าน",
  "auth.password_reset": "ตั้งรหัสผ่านใหม่ผ่านลิงก์",
  "auth.sessions_revoke": "ออกจากระบบอุปกรณ์อื่น",
  "auth.profile_update": "แก้ไขโปรไฟล์",
  "user.invite": "เชิญผู้ใช้",
  "user.invite_resend": "ส่งคำเชิญอีกครั้ง",
  "user.invite_revoke": "ยกเลิกคำเชิญ",
  "user.invite_accept": "ยอมรับคำเชิญ",
  "user.role_change": "เปลี่ยนบทบาท",
  "user.deactivate": "ระงับผู้ใช้",
  "user.reactivate": "เปิดใช้งานผู้ใช้",
  "user.reset_issue": "สร้างลิงก์ตั้งรหัสผ่าน",
  "user.delete": "ลบผู้ใช้",
  "post.create": "สร้างบทความ",
  "post.update": "แก้ไขบทความ",
  "post.publish": "เผยแพร่บทความ",
  "post.unpublish": "ยกเลิกเผยแพร่",
  "post.schedule": "ตั้งเวลาเผยแพร่",
  "post.delete": "ลบบทความ",
  "media.upload": "อัปโหลดสื่อ",
  "media.update": "แก้ไขสื่อ",
  "media.delete": "ลบสื่อ",
  "lead.status_change": "เปลี่ยนสถานะ Lead",
  "lead.note": "เพิ่มบันทึก Lead",
  "lead.assign": "มอบหมาย Lead",
  "lead.export": "ส่งออก Leads (CSV)",
  "redirect.create": "สร้าง Redirect",
  "redirect.update": "แก้ไข Redirect",
  "redirect.delete": "ลบ Redirect",
};
