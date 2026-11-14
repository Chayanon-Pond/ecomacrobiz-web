import { Suspense, type ReactNode } from "react";
import { AuthSkeleton } from "@/components/admin/auth/AuthFrame";

export const instant = false;

/** Public admin pages (login, invite). No session check. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AuthSkeleton />}>{children}</Suspense>;
}
