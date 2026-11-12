import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { AdminShell, Spinner } from "@/components/admin/AdminShell";
import "@/components/admin/admin.css";

// Inherited by every /admin page (child metadata only overrides `title`).
export const metadata: Metadata = {
  title: { default: "ผู้ดูแลระบบ", template: "%s | Admin ECOMACROBIZ" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

// Admin UI is client-rendered behind the session check (see AdminShell).
export const instant = false;

export default function AdminLayout({ children }: { children: ReactNode }) {
  // The whole admin UI is client-rendered behind the session check, so the
  // prerendered shell is just this fallback (cacheComponents-friendly).
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center">
          <Spinner />
        </div>
      }
    >
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
