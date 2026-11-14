import type { Metadata } from "next";
import { LinkGoogleView } from "@/components/community/account/TokenViews";

export const metadata: Metadata = {
  title: "เชื่อมต่อบัญชี Google",
  robots: { index: false, follow: false },
};

export default function LinkGooglePage() {
  return <LinkGoogleView />;
}
