/**
 * Tiny client-side member session store (no React dependency, so the initial
 * article bundle stays small). `useSyncExternalStore(subscribe, getSnapshot)`
 * works with it directly.
 *
 * Status: "unknown" until the first /auth/me resolves.
 */
import type { Me, PendingAction, Session } from "./types";

export type SessionState =
  | { status: "unknown"; me: null }
  | { status: "anonymous"; me: null }
  | { status: "member"; me: Me };

let state: SessionState = { status: "unknown", me: null };
let csrf: string | null = null;
let inflight: Promise<SessionState> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SessionState {
  return state;
}

// Must be a stable reference (useSyncExternalStore compares snapshots by identity).
const SERVER_SNAPSHOT: SessionState = { status: "unknown", me: null };

export function getServerSnapshot(): SessionState {
  return SERVER_SNAPSHOT;
}

export function getCsrf(): string | null {
  return csrf;
}

export function setSession(s: Session | null) {
  csrf = s?.csrf_token ?? null;
  state = s ? { status: "member", me: s.member } : { status: "anonymous", me: null };
  emit();
}

/** Updates the member after a profile/avatar/email change (keeps the CSRF token). */
export function setMe(me: Me) {
  state = { status: "member", me };
  emit();
}

/** Loads /auth/me once (deduped); `force` refetches. Never throws. */
export function loadSession(force = false): Promise<SessionState> {
  if (!force && state.status !== "unknown") return Promise.resolve(state);
  if (inflight && !force) return inflight;
  inflight = fetch("/api/community/auth/me", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  })
    .then(async (res) => {
      const json = res.ok ? ((await res.json()) as { data: Session | null }) : { data: null };
      setSession(json.data);
      return state;
    })
    .catch(() => {
      setSession(null);
      return state;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/* ---------------- pending action (survives the Google redirect) ---------------- */

const PENDING_KEY = "escoma:community:pending";
const PENDING_TTL_MS = 10 * 60 * 1000;

export function savePendingAction(action: PendingAction) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), action }));
  } catch {
    /* private mode / storage blocked: the action is simply not resumed */
  }
}

/** Returns and clears the pending action if it is fresh (≤ 10 min). */
export function takePendingAction(): PendingAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; action?: PendingAction };
    if (!parsed.action || typeof parsed.at !== "number" || Date.now() - parsed.at > PENDING_TTL_MS) return null;
    return parsed.action;
  } catch {
    return null;
  }
}
