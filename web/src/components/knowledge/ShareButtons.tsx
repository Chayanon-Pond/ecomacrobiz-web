"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SocialIcon } from "@/components/ui/SocialIcon";

const noopSubscribe = () => () => {};
/** navigator.share on touch devices only (desktop share sheets are clunky). */
function canNativeShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari / insecure context fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line-strong px-4 text-sm text-muted transition-colors duration-300 hover:border-fg/50 hover:text-fg";

export function ShareButtons({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const native = useSyncExternalStore(noopSubscribe, canNativeShare, () => false);
  const [status, setStatus] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const announce = useCallback((msg: string) => {
    setStatus(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(""), 3000);
  }, []);

  const u = encodeURIComponent(url);
  const links = [
    { id: "line" as const, label: "LINE", href: `https://social-plugins.line.me/lineit/share?url=${u}` },
    { id: "facebook" as const, label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: "linkedin" as const, label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className={compact ? "eyebrow" : "text-sm font-medium text-fg"}>แชร์บทความนี้</p>
      <ul className="flex flex-wrap gap-2">
        {native && (
          <li>
            <button
              type="button"
              className={btn}
              onClick={() => navigator.share({ title, url }).catch(() => {})}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
                <path d="M10 3v10m0-10L6.5 6.5M10 3l3.5 3.5M4 11v4.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              แชร์
            </button>
          </li>
        )}
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className={btn}
              aria-label={`แชร์ไปที่ ${l.label} (เปิดหน้าต่างใหม่)`}
            >
              <SocialIcon id={l.id} className="size-4" />
              {!compact && <span>{l.label}</span>}
            </a>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={btn}
            onClick={async () => announce((await copyText(url)) ? "คัดลอกลิงก์แล้ว" : "คัดลอกไม่สำเร็จ กรุณาคัดลอกจากแถบที่อยู่")}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
              <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-.75.75M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l.75-.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className={compact ? "sr-only" : undefined}>คัดลอกลิงก์</span>
          </button>
        </li>
      </ul>
      <p role="status" aria-live="polite" className="min-h-[1.5em] text-sm text-accent-soft">
        {status}
      </p>
    </div>
  );
}
