/**
 * Motion preferences shared by every animated component.
 *
 * The inline head script (MOTION_BOOTSTRAP) sets <html data-motion> before
 * first paint so CSS can decide initial states without a flash. JS reads the
 * same attribute so CSS and JS never disagree.
 */

// `?motion=reduced` forces the reduced experience (QA / accessibility review).
export const MOTION_BOOTSTRAP = `(function(){try{var d=document.documentElement;var r=(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)||/[?&]motion=reduced/.test(location.search);d.setAttribute('data-motion',r?'reduced':'full');}catch(e){}})();`;

export function isMotionEnabled(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.motion === "full";
}

/** Fine pointer with real hover (mouse/trackpad) — never touch/iPad finger. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export function hasFinePointer(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

/** Mark that the animation runtime is live (disables CSS reveal fallback). */
export function markMotionReady(): void {
  document.documentElement.classList.add("motion-ready");
}
