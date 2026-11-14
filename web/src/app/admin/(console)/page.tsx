import type { Metadata } from "next";
import { DashboardPage } from "@/components/admin/dashboard/DashboardPage";

export const metadata: Metadata = { title: { absolute: "ภาพรวม | Admin ECOMACROBIZ" } };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminHomePage() {
  return <DashboardPage />;
}
