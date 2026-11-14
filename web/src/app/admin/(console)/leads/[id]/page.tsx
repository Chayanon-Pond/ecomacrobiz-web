import type { Metadata } from "next";
import { LeadDetail } from "@/components/admin/LeadDetail";

export const metadata: Metadata = { title: "รายละเอียดผู้ติดต่อ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminLeadPage() {
  return <LeadDetail />;
}
