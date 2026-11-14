import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ADMIN_PREFS_BOOTSTRAP } from "@/components/admin/shell/prefs-shared";
import { ToastProvider } from "@/components/admin/ui/Toast";
import "@/components/admin/admin.css";
import "@/components/admin/tokens.css";
import "@/components/admin/ui/ui.css";
import "@/components/admin/shell/shell.css";
import "@/components/admin/leads/leads.css";

// Inherited by every /admin page (child metadata only overrides `title`).
export const metadata: Metadata = {
  title: { default: "ผู้ดูแลระบบ", template: "%s | Admin ECOMACROBIZ" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

// The console blocks on a server-side session check (see (console)/layout.tsx).
export const instant = false;

/**
 * Admin root: theme scope + toasts. Route groups:
 *   (auth)    /admin/login, /admin/invite  — public
 *   (console) everything else              — server-verified session
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="adm-root">
      {/* Applies the stored theme + sidebar state before first paint (no flash). */}
      <script dangerouslySetInnerHTML={{ __html: ADMIN_PREFS_BOOTSTRAP }} />
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
