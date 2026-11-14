import type { Metadata } from "next";
import { PostEditorLoader } from "@/components/admin/posts/PostEditorLoader";

export const metadata: Metadata = { title: "เขียนบทความใหม่" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminNewPostPage() {
  return <PostEditorLoader />;
}
