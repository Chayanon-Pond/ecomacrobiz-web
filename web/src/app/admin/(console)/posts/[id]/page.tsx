import type { Metadata } from "next";
import { PostEditorLoader } from "@/components/admin/posts/PostEditorLoader";

export const metadata: Metadata = { title: "แก้ไขบทความ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

// The id is read client-side (useParams) by the lazily loaded editor.
export default function AdminEditPostPage() {
  return <PostEditorLoader edit />;
}
