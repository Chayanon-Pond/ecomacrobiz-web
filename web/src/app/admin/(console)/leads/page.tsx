import type { Metadata } from "next";
import { LeadsPage } from "@/components/admin/leads/LeadsPage";

export const metadata: Metadata = { title: "รายชื่อผู้ติดต่อ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminLeadsPage() {
  return <LeadsPage />;
}
