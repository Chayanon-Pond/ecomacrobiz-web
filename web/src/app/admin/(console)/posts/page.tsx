import type { Metadata } from "next";
import { PostsList } from "@/components/admin/PostsList";

export const metadata: Metadata = { title: "บทความ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminPostsPage() {
  return <PostsList />;
}
