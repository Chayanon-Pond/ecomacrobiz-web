import type { Metadata } from "next";
import { ResetPasswordView } from "@/components/community/account/TokenViews";

export const metadata: Metadata = {
  title: "ตั้งรหัสผ่านใหม่",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
