import type { Metadata } from "next";
import { LeadsList } from "@/components/admin/LeadsList";

export const metadata: Metadata = { title: "รายชื่อผู้ติดต่อ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminLeadsPage() {
  return <LeadsList />;
}
