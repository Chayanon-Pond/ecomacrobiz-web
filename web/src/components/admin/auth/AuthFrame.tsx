import type { ReactNode } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { Skeleton } from "../ui/Skeleton";

/** Centered card layout for login / invite / reset. */
export function AuthFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="adm-fullpage relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-18rem] h-[32rem] w-[48rem] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent-glow), transparent)" }}
      />
      <div className="relative w-full max-w-[25rem]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark className="h-6 w-auto" />
          <span className="font-display text-sm font-semibold tracking-[0.08em]">ECOMACROBIZ</span>
          <span className="adm-badge" data-tone="info">
            Admin
          </span>
        </div>
        <div className="adm-card p-6 sm:p-7">{children}</div>
        {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </main>
  );
}

export function AuthSkeleton() {
  return (
    <AuthFrame>
      <div className="grid gap-4" role="status">
        <span className="adm-sr-only">กำลังโหลด…</span>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </AuthFrame>
  );
}
