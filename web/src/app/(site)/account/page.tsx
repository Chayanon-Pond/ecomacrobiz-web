import type { Metadata } from "next";
import { AccountApp } from "@/components/community/account/AccountApp";

// Private, per-member page: never indexed (also disallowed in robots.ts).
export const metadata: Metadata = {
  title: "บัญชีสมาชิก",
  description: "จัดการบัญชีสมาชิก ECOMACROBIZ: โปรไฟล์ อีเมล รหัสผ่าน การเชื่อมต่อ Google และข้อมูลของคุณ",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account" },
};

export default function AccountPage() {
  return <AccountApp />;
}
