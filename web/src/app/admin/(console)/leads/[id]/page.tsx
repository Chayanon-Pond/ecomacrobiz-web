import type { Metadata } from "next";
import { LeadDetailPage } from "@/components/admin/leads/LeadDetailPage";

export const metadata: Metadata = { title: "รายละเอียดผู้ติดต่อ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminLeadPage() {
  return <LeadDetailPage />;
}
