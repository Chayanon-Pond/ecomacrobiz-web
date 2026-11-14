import type { Metadata } from "next";
import { MediaPage } from "@/components/admin/media/MediaPage";

export const metadata: Metadata = { title: "คลังสื่อ" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminMediaPage() {
  return <MediaPage />;
}
