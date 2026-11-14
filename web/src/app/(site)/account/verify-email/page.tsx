import type { Metadata } from "next";
import { VerifyEmailView } from "@/components/community/account/TokenViews";

export const metadata: Metadata = {
  title: "ยืนยันอีเมล",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return <VerifyEmailView />;
}
