import type { Metadata } from "next";
import { InviteAccept } from "@/components/admin/auth/InviteAccept";

export const metadata: Metadata = { title: "ตั้งค่าบัญชี", referrer: "no-referrer" };
export const instant = false;

export default function AdminInvitePage() {
  return <InviteAccept />;
}
