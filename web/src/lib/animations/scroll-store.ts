/**
 * Tiny module-level handle to the Lenis instance so UI (mobile menu, anchor
 * buttons) can stop/start/scroll without prop drilling or context re-renders.
 */
import type Lenis from "lenis";

let instance: Lenis | null = null;

export function setLenis(lenis: Lenis | null): void {
  instance = lenis;
}

export function getLenis(): Lenis | null {
  return instance;
}

/** Lock page scroll (menu open). Works with and without Lenis. */
export function lockScroll(locked: boolean): void {
  if (instance) {
    if (locked) instance.stop();
    else instance.start();
  }
  document.documentElement.style.overflow = locked ? "hidden" : "";
}
