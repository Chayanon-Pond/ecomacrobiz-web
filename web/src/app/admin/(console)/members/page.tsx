import type { Metadata } from "next";
import { MembersPage } from "@/components/admin/community/MembersPage";

export const metadata: Metadata = { title: "สมาชิก" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminMembersPage() {
  return <MembersPage />;
}
