"use client";

/**
 * Per-browser admin UI prefs (theme, sidebar, leads view). Stored in
 * localStorage (every access wrapped in try/catch: private mode / blocked
 * storage must not break the page) and mirrored on <html data-adm-*> so CSS
 * can apply them before hydration (see ADMIN_PREFS_BOOTSTRAP).
 */
import { useSyncExternalStore } from "react";
import { PREF_KEYS } from "./prefs-shared";

export { PREF_KEYS };

const EVENT = "adm-prefs";

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export type Theme = "dark" | "light";

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.admTheme === "light" ? "light" : "dark"),
    () => "dark" as Theme,
  );
  return [
    theme,
    (t: Theme) => {
      document.documentElement.dataset.admTheme = t;
      writePref(PREF_KEYS.theme, t);
    },
  ];
}

export function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.admSidebar === "collapsed",
    () => false,
  );
  return [
    collapsed,
    (v: boolean) => {
      if (v) document.documentElement.dataset.admSidebar = "collapsed";
      else delete document.documentElement.dataset.admSidebar;
      writePref(PREF_KEYS.sidebar, v ? "collapsed" : "expanded");
    },
  ];
}

/** Generic string pref (e.g. leads view "table" | "board"). */
export function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readPref(key),
    () => null,
  );
  const value = raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  return [value, (v: T) => writePref(key, v)];
}
