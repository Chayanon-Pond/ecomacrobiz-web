"use client";

import { useSyncExternalStore } from "react";

/** SSR-safe media query hook (false on the server and during hydration). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True when <html data-motion="full"> (set before paint by the head script). */
export function useMotionEnabled(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => document.documentElement.dataset.motion === "full",
    () => false,
  );
}
