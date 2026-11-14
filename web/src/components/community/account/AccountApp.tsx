"use client";

/**
 * /account: inline sign-in when logged out; settings tabs when signed in.
 * Tab state lives in `?tab=` (the Google "connect" round-trip returns to
 * /account?tab=connections). Handles `#community=<outcome>` after Google.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { communityJson } from "@/lib/community/client";
import { getLenis } from "@/lib/animations/scroll-store";
import { useMediaQuery } from "@/lib/animations/use-media-query";
import { setSession } from "@/lib/community/session";
import type { CommunityConfig, Me } from "@/lib/community/types";
import { oauthErrorMessage, readOAuthOutcome, type OAuthResult } from "../auth/auth-urls";
import { AuthPanel } from "../auth/AuthPanel";
import { useCommunityConfig } from "../auth/config";
import { Alert } from "../auth/fields";
import { DataSection, DeleteSection, SessionsSection } from "./DataSections";
import { ProfileSection } from "./ProfileSection";
import { ConnectionsSection, EmailSection, PasswordSection } from "./SecuritySections";
import { AccountPageFrame, MemberAvatar, PageSpinner, useSession } from "./ui";

const TABS = [
  { id: "profile", label: "โปรไฟล์" },
  { id: "email", label: "อีเมล" },
  { id: "password", label: "รหัสผ่าน" },
  { id: "connections", label: "การเชื่อมต่อ" },
  { id: "sessions", label: "อุปกรณ์ที่เข้าสู่ระบบ" },
  { id: "data", label: "ข้อมูลของฉัน" },
  { id: "delete", label: "ลบบัญชี" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function isTab(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v);
}

type Flash = { tone: "error" | "success" | "info"; text: string };

function flashFor(o: OAuthResult, tab: string | null): Flash | null {
  if (o.kind === "signed-in") return { tone: "success", text: tab === "connections" ? "เชื่อมต่อ Google เรียบร้อย" : "เข้าสู่ระบบด้วย Google เรียบร้อย" };
  if (o.kind === "error") {
    // From "connect Google" (no consent): a Google account with another e-mail.
    if (o.code === "consent" && tab === "connections") {
      return { tone: "error", text: "เชื่อมต่อไม่สำเร็จ: อีเมลของบัญชี Google ที่เลือกไม่ตรงกับอีเมลของบัญชีนี้" };
    }
    return { tone: "error", text: oauthErrorMessage(o.code) };
  }
  return null;
}

/** Reads (once) the Google outcome in the fragment; the effect below strips it. */
function initialFlash(): Flash | null {
  if (typeof window === "undefined") return null;
  const o = readOAuthOutcome(window.location.hash);
  return o ? flashFor(o, new URLSearchParams(window.location.search).get("tab")) : null;
}

export function AccountApp() {
  const session = useSession();
  const config = useCommunityConfig();
  const [flash, setFlash] = useState<Flash | null>(initialFlash);

  useEffect(() => {
    if (window.location.hash.includes("community=")) {
      history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  if (session.status === "unknown") {
    return (
      <div className="container-page pb-24 pt-[calc(var(--header-h)+4rem)]">
        <PageSpinner />
      </div>
    );
  }

  if (session.status === "anonymous") {
    return (
      <AccountPageFrame
        eyebrow="Member account"
        title="บัญชีสมาชิก"
        intro="เข้าสู่ระบบหรือสมัครสมาชิกเพื่อแสดงความคิดเห็นและกดถูกใจบทความ และจัดการข้อมูลบัญชีของคุณ"
      >
        {flash && (
          <Alert tone={flash.tone} className="mb-5">
            {flash.text}
          </Alert>
        )}
        <AuthPanel
          googleNext="/account"
          headingLevel="h2"
          // Client-only branch (after /auth/me), so reading the URL is safe.
          initialView={new URLSearchParams(window.location.search).get("view") === "forgot" ? "forgot" : "tabs"}
          onSuccess={() => {
            setFlash(null);
            const lenis = getLenis();
            if (lenis) lenis.scrollTo(0, { immediate: true });
            else window.scrollTo({ top: 0 });
          }}
        />
      </AccountPageFrame>
    );
  }

  return <AccountDashboard me={session.me} config={config} flash={flash} onFlash={setFlash} />;
}

function readTab(): TabId {
  const t = new URLSearchParams(window.location.search).get("tab") ?? window.location.hash.replace(/^#/, "");
  return isTab(t) ? t : "profile";
}

function AccountDashboard({
  me,
  config,
  flash,
  onFlash,
}: {
  me: Me;
  config: CommunityConfig | null | undefined;
  flash: Flash | null;
  onFlash: (f: Flash | null) => void;
}) {
  // Only ever rendered on the client (after /auth/me), so reading the URL here is safe.
  const [tab, setTab] = useState<TabId>(readTab);
  const [signingOut, setSigningOut] = useState(false);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const vertical = useMediaQuery("(min-width: 64rem)");

  useEffect(() => {
    // Horizontal tab strip (phones/tablets): bring the active tab into view without moving the page.
    const el = tabRefs.current[tab];
    const strip = el?.parentElement;
    if (el && strip && strip.scrollWidth > strip.clientWidth) {
      const a = el.getBoundingClientRect();
      const b = strip.getBoundingClientRect();
      strip.scrollTo({ left: strip.scrollLeft + a.left - b.left - (b.width - a.width) / 2, behavior: "smooth" });
    }
  }, [tab]);

  const select = (t: TabId, focus = false) => {
    setTab(t);
    onFlash(null);
    const url = new URL(window.location.href);
    if (t === "profile") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    url.hash = "";
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    if (focus) tabRefs.current[t]?.focus();
  };

  const goTo = (t: TabId) => {
    select(t);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: false }));
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    select(TABS[n].id, true);
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await communityJson<null>("auth/logout", { method: "POST" });
    } catch {
      /* expired session: signing out locally is still correct */
    }
    setSession(null);
    onFlash({ tone: "info", text: "ออกจากระบบแล้ว" });
  };

  const banned = me.role === "banned";

  return (
    <div className="container-page pb-[clamp(4rem,12vh,8rem)] pt-[calc(var(--header-h)+clamp(1.5rem,5vh,3.5rem))]">
      <div className="mx-auto max-w-[68rem]">
        <header className="flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <MemberAvatar id={me.id} name={me.display_name} url={me.avatar_url} size={64} />
            <div className="min-w-0">
              <p className="eyebrow mb-1">Member account</p>
              <h1 className="thai-heading truncate text-[clamp(1.5rem,4vw,2.1rem)] font-semibold leading-tight">{me.display_name}</h1>
              <p className="truncate text-sm text-muted">{me.email}</p>
            </div>
          </div>
          <button type="button" onClick={signOut} disabled={signingOut} className="ca-btn ca-btn-ghost self-start sm:self-auto">
            {signingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
          </button>
        </header>

        {banned && (
          <Alert className="mt-6">บัญชีของคุณถูกระงับการแสดงความคิดเห็น คุณยังจัดการข้อมูลบัญชี ดาวน์โหลดข้อมูล หรือลบบัญชีได้ หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อเรา</Alert>
        )}
        {flash && (
          <Alert tone={flash.tone} className="mt-6">
            {flash.text}
          </Alert>
        )}

        <div className="mt-6 lg:mt-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
          <div
            role="tablist"
            aria-label="การตั้งค่าบัญชี"
            aria-orientation={vertical ? "vertical" : "horizontal"}
            className="ca-scroll-x -mx-[var(--gutter)] flex snap-x gap-1 overflow-x-auto px-[var(--gutter)] pb-1 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`acc-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="acc-panel"
                tabIndex={tab === t.id ? 0 : -1}
                data-danger={t.id === "delete" || undefined}
                onClick={() => select(t.id)}
                onKeyDown={onKey}
                className="ca-acc-tab inline-flex min-h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-4 text-[0.95rem] font-medium transition-colors lg:w-full lg:rounded-xl"
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            ref={panelRef}
            id="acc-panel"
            role="tabpanel"
            aria-labelledby={`acc-tab-${tab}`}
            tabIndex={-1}
            className="mt-5 outline-none lg:mt-0"
          >
            {tab === "profile" && <ProfileSection key={me.id} me={me} config={config} />}
            {tab === "email" && <EmailSection me={me} config={config} onGoToPassword={() => goTo("password")} />}
            {tab === "password" && <PasswordSection me={me} />}
            {tab === "connections" && <ConnectionsSection me={me} config={config} onGoToPassword={() => goTo("password")} />}
            {tab === "sessions" && <SessionsSection />}
            {tab === "data" && <DataSection />}
            {tab === "delete" && <DeleteSection me={me} />}
          </div>
        </div>
      </div>
    </div>
  );
}
