import type { Metadata } from "next";
import { PostEditor } from "@/components/admin/PostEditor";

export const metadata: Metadata = { title: "แก้ไขบทความ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

// The id is read client-side (useParams) inside the admin layout's Suspense.
export default function AdminEditPostPage() {
  return <PostEditor edit />;
}
