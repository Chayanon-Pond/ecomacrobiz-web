"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Stats } from "@/lib/community/types";
import { StatsBarView } from "./StatsViews";
import { getStatsState, likePost, subscribeStats } from "./stats-store";
import { takeIntent } from "./loader";

/** Live version of the article stats bar (same markup as the server one). */
export function LiveStatsBar({ slug, initial }: { slug: string; initial: Stats }) {
  const getSnap = useCallback(() => getStatsState(slug), [slug]);
  const state = useSyncExternalStore(subscribeStats, getSnap, getSnap);
  const rootRef = useRef<HTMLDivElement>(null);

  const likeButton = () => rootRef.current?.querySelector<HTMLElement>('[data-engage="like-post"]') ?? null;

  useEffect(() => {
    const intent = takeIntent("stats");
    if (intent?.action === "like-post") {
      likeButton()?.focus();
      void likePost(slug, undefined, likeButton());
    }
  }, [slug]);

  return (
    <div ref={rootRef}>
      <StatsBarView
        stats={state?.stats ?? initial}
        liked={state?.liked ?? false}
        busy={state?.busy ?? false}
        live
        onLike={() => void likePost(slug, undefined, likeButton())}
      />
      <p role="status" aria-live="polite" className={state?.error ? "text-sm text-amber-300" : "sr-only"}>
        {state?.error ?? ""}
      </p>
    </div>
  );
}
