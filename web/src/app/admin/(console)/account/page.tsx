import type { Metadata } from "next";
import { AccountPage } from "@/components/admin/account/AccountPage";

export const metadata: Metadata = { title: "บัญชีของฉัน" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminAccountPage() {
  return <AccountPage />;
}
