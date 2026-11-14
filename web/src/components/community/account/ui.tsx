"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getServerSnapshot, getSnapshot, loadSession, subscribe, type SessionState } from "@/lib/community/session";
import { avatarColor, initials } from "@/lib/community/avatar";
import "../auth/auth.css";

/** Member session (loads /auth/me once). */
export function useSession(): SessionState {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void loadSession();
  }, []);
  return s;
}

const dateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const dateOnly = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : dateTime.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : dateOnly.format(d);
}

export function MemberAvatar({
  id,
  name,
  url,
  size = 48,
  className = "",
}: {
  id: string;
  name: string;
  url: string | null;
  size?: number;
  className?: string;
}) {
  if (url) {
    return (
      // Member avatars are already ≤ 512 px JPEGs from the API; next/image adds nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" width={size} height={size} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ width: size, height: size, background: avatarColor(id), fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  );
}

export function Section({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border p-5 sm:p-7 ${
        tone === "danger" ? "border-[rgb(255_120_120/0.35)] bg-[rgb(255_60_60/0.04)]" : "border-line bg-surface"
      }`}
    >
      <h3 className={`thai-heading text-lg font-semibold ${tone === "danger" ? "text-[#ffb4b4]" : ""}`}>{title}</h3>
      {description && <div className="mt-1.5 text-sm leading-6 text-muted">{description}</div>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Narrow centered page used by the logged-out account page and the token pages. */
export function AccountPageFrame({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="container-page pb-[clamp(4rem,12vh,8rem)] pt-[calc(var(--header-h)+clamp(2rem,7vh,4.5rem))]">
      <div className="mx-auto w-full max-w-[30rem]">
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="thai-heading text-[clamp(1.75rem,4.5vw,2.5rem)] font-semibold">{title}</h1>
        {intro && <div className="mt-3 leading-7 text-muted">{intro}</div>}
        <div className="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-7">{children}</div>
      </div>
    </div>
  );
}

export function PageSpinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-40 items-center justify-center gap-3 text-muted">
      <span aria-hidden="true" className="ca-spinner inline-block" />
      <span>{label}</span>
    </div>
  );
}
