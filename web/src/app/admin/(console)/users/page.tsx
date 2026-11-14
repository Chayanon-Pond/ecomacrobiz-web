import type { Metadata } from "next";
import { UsersPage } from "@/components/admin/users/UsersPage";

export const metadata: Metadata = { title: "ผู้ใช้และสิทธิ์" };
// Client-rendered behind the session check: nothing to prerender for instant navigation.
export const instant = false;

export default function AdminUsersPage() {
  return <UsersPage />;
}
