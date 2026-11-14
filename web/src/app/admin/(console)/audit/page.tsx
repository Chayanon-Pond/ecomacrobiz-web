import type { Metadata } from "next";
import { AuditPage } from "@/components/admin/audit/AuditPage";

export const metadata: Metadata = { title: "บันทึกกิจกรรม" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminAuditPage() {
  return <AuditPage />;
}
