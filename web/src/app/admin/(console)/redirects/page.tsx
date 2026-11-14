import type { Metadata } from "next";
import { RedirectsPage } from "@/components/admin/redirects/RedirectsPage";

export const metadata: Metadata = { title: "เปลี่ยนเส้นทาง URL" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminRedirectsPage() {
  return <RedirectsPage />;
}
