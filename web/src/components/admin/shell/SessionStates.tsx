"use client";

import { RotateCw, ServerCrash } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/ui/Logo";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";

/** Neutral placeholder while the server verifies the session (no user data). */
export function ConsoleSkeleton() {
  return (
    <div className="adm-shell" aria-busy="true">
      <div className="adm-sidebar" aria-hidden="true">
        <div className="adm-sb-brand">
          <LogoMark className="h-5 w-auto shrink-0" />
        </div>
        <div className="grid gap-2 p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div className="adm-main-col">
        <div className="adm-topbar" aria-hidden="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-8 w-8 rounded-full" />
        </div>
        <div className="adm-main" role="status">
          <span className="adm-sr-only">กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…</span>
          <Skeleton className="mb-6 h-8 w-56" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <Skeleton className="mt-6 h-72 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/** API unreachable during the server session check: never render the console. */
export function SessionUnavailable({ message }: { message: string }) {
  return (
    <main className="adm-fullpage">
      <div className="adm-card w-full max-w-md p-6 text-center" role="alert">
        <span className="adm-empty-icon mx-auto mb-3" style={{ background: "var(--adm-danger-bg)", color: "var(--adm-danger)", borderColor: "var(--adm-danger-border)" }}>
          <ServerCrash size={22} aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold thai-heading">ยังเชื่อมต่อระบบหลังบ้านไม่ได้</h1>
        <p className="mt-1 text-sm text-muted">{message} — กรุณาลองใหม่อีกครั้งในอีกสักครู่</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<RotateCw size={16} aria-hidden="true" />} onClick={() => window.location.reload()}>
            ลองใหม่
          </Button>
          <Link href="/" className="adm-btn">
            กลับหน้าเว็บไซต์
          </Link>
        </div>
      </div>
    </main>
  );
}
