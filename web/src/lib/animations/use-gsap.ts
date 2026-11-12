"use client";

import { useEffect, useRef, type RefObject } from "react";
import { loadGsap, type GsapBundle } from "./gsap";
import { isMotionEnabled } from "./motion";

type Setup = (bundle: GsapBundle, scope: HTMLElement) => void | (() => void);

/**
 * Runs a GSAP setup scoped to `scope` once GSAP has lazy-loaded.
 * - Skipped entirely when the user prefers reduced motion.
 * - Everything created inside is reverted on unmount (gsap.context).
 */
export function useGsap<T extends HTMLElement>(
  setup: Setup,
): RefObject<T | null> {
  const scope = useRef<T | null>(null);
  const setupRef = useRef(setup);

  useEffect(() => {
    setupRef.current = setup;
  });

  useEffect(() => {
    const el = scope.current;
    if (!el || !isMotionEnabled()) return;

    let cancelled = false;
    let revert: (() => void) | undefined;

    loadGsap().then((bundle) => {
      if (cancelled) return;
      let extraCleanup: void | (() => void);
      const ctx = bundle.gsap.context(() => {
        extraCleanup = setupRef.current(bundle, el);
      }, el);
      revert = () => {
        if (typeof extraCleanup === "function") extraCleanup();
        ctx.revert();
      };
    });

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return scope;
}
