import type { Metadata } from "next";
import { CommentsPage } from "@/components/admin/community/CommentsPage";

export const metadata: Metadata = { title: "ความคิดเห็น" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminCommentsPage() {
  return <CommentsPage />;
}
