/**
 * GET /config once per page load (deduped). Resolves null when the API is
 * unreachable, so callers degrade (no Google button, register explains).
 */
import { useEffect, useState } from "react";
import { communityJson } from "@/lib/community/client";
import type { CommunityConfig } from "@/lib/community/types";

let cached: CommunityConfig | null = null;
let inflight: Promise<CommunityConfig | null> | null = null;

export function loadCommunityConfig(): Promise<CommunityConfig | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = communityJson<CommunityConfig>("config")
      .then((c) => (cached = c))
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** `undefined` while loading, `null` when unavailable. */
export function useCommunityConfig(): CommunityConfig | null | undefined {
  const [config, setConfig] = useState<CommunityConfig | null | undefined>(cached ?? undefined);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void loadCommunityConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export function turnstileEnabled(config: CommunityConfig | null | undefined): boolean {
  return Boolean(TURNSTILE_SITE_KEY && config?.turnstile);
}
