"use client";

/**
 * The only community code in the initial article bundle. Each island renders
 * its server markup (`children`) until the loader activates, then swaps in
 * the live component from the lazily imported runtime chunk — same DOM, live
 * data. If the runtime cannot boot (offline/API down) the static markup stays
 * and the next interaction retries.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Stats } from "@/lib/community/types";
import { initEngagement, loadRuntime, observeNear, onActivate, resetActivation } from "./loader";

type Live<P> = { C: ComponentType<P> } | null;

function useIsland<P>(slug: string, pick: (m: typeof import("./runtime")) => ComponentType<P>) {
  const [live, setLive] = useState<Live<P>>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => initEngagement(slug), [slug]);
  useEffect(() => {
    let cancelled = false;
    const off = onActivate(() => {
      setFailed(false);
      loadRuntime()
        .then(async (m) => {
          await m.boot(slug);
          if (!cancelled) setLive({ C: pick(m) });
        })
        .catch(() => {
          resetActivation();
          if (!cancelled) setFailed(true);
        });
    });
    return () => {
      cancelled = true;
      off();
    };
    // `pick` is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  return { live, failed };
}

const pickStats = (m: typeof import("./runtime")) => m.LiveStatsBar;
const pickComments = (m: typeof import("./runtime")) => m.CommentsApp;

export function StatsIsland({ slug, stats, children }: { slug: string; stats: Stats; children: ReactNode }) {
  const { live } = useIsland(slug, pickStats);
  return live ? <live.C slug={slug} initial={stats} /> : children;
}

export function CommentsIsland({ slug, children }: { slug: string; children: ReactNode }) {
  const { live, failed } = useIsland(slug, pickComments);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? observeNear(ref.current) : undefined), []);
  return (
    <div ref={ref}>
      {live ? <live.C slug={slug} /> : children}
      {failed && !live && (
        <p role="alert" className="mt-4 text-sm text-amber-300">
          เชื่อมต่อระบบความคิดเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </p>
      )}
    </div>
  );
}
