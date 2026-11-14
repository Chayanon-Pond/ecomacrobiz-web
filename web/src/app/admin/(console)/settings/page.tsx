import type { Metadata } from "next";
import { SettingsPage } from "@/components/admin/settings/SettingsPage";

export const metadata: Metadata = { title: "การตั้งค่า" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminSettingsPage() {
  return <SettingsPage />;
}
