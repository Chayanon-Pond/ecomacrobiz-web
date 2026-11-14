"use client";

/**
 * Admin session (client side). The server already verified the session in
 * app/admin/(console)/layout.tsx and passes the SessionPayload in as
 * `initial`, so nothing renders unauthenticated and there is no client
 * flash. The session cookie is HttpOnly; the CSRF token lives only in memory.
 *
 * request():
 *  - adds X-CSRF-Token on mutations;
 *  - 403 on a mutation whose message is NOT the permission message => stale
 *    CSRF (new session in another tab): refresh /auth/me and retry once;
 *  - 403 permission on a mutation => toast the API message (no logout);
 *  - 401 => hard redirect to /admin/login?next=<current path>.
 */
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, MSG_NO_PERMISSION, rawRequest, toApiError, type RequestOptions } from "@/lib/admin/client";
import { loginUrl } from "@/lib/admin/next-path";
import { can as canFn, canAny as canAnyFn, type Permission } from "@/lib/admin/permissions";
import type { AdminUser, SessionPayload } from "@/lib/admin/types";
import { useToast } from "./ui/Toast";

export type AdminRequest = <T>(path: string, opts?: RequestOptions) => Promise<T>;

type SessionCtx = {
  /** Always "authed" inside the console (kept for older callers). */
  status: "authed" | "anon";
  user: AdminUser;
  permissions: Permission[];
  /** true when the user has ALL of the permissions (cosmetic; the API enforces). */
  can: (...need: Permission[]) => boolean;
  /** true when the user has ANY of the permissions. */
  canAny: (...need: Permission[]) => boolean;
  request: AdminRequest;
  /** Same as request but resolves with the raw Response (downloads). */
  requestRaw: (path: string, opts?: RequestOptions) => Promise<Response>;
  setSession: (s: SessionPayload) => void;
  /** Local update after PUT /account/profile. */
  updateUser: (u: AdminUser) => void;
  /** Re-reads /auth/me (role or permissions may have changed). */
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

export function useAdmin(): SessionCtx {
  const v = use(Ctx);
  if (!v) throw new Error("useAdmin must be used inside <SessionProvider>");
  return v;
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function SessionProvider({ initial, children }: { initial: SessionPayload; children: ReactNode }) {
  const toast = useToast();
  const [user, setUser] = useState<AdminUser>(initial.user);
  const [permissions, setPermissions] = useState<Permission[]>(initial.permissions);
  const csrf = useRef<string>(initial.csrf_token);
  const leaving = useRef(false);

  const setSession = useCallback((s: SessionPayload) => {
    csrf.current = s.csrf_token;
    setUser(s.user);
    setPermissions(s.permissions);
  }, []);

  const toLogin = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    // Hard navigation: drops all client state and re-runs the server check.
    window.location.assign(loginUrl(currentPath()));
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await rawRequest("auth/me", {}, null);
      if (res.status === 401) {
        toLogin();
        return false;
      }
      if (!res.ok) return false;
      const json = (await res.json()) as { data: SessionPayload };
      setSession(json.data);
      return true;
    } catch {
      return false;
    }
  }, [setSession, toLogin]);

  const requestRaw = useCallback(
    async (path: string, opts: RequestOptions = {}): Promise<Response> => {
      const mutation = (opts.method ?? "GET") !== "GET";
      let res = await rawRequest(path, opts, csrf.current);
      if (res.status === 403 && mutation) {
        const err = await toApiError(res.clone());
        if (err.message !== MSG_NO_PERMISSION && (await refresh())) {
          res = await rawRequest(path, opts, csrf.current);
        }
      }
      if (res.status === 401) {
        toLogin();
        throw await toApiError(res);
      }
      if (res.status === 403 && mutation) {
        const err = await toApiError(res);
        err.notified = true;
        toast.error(err.message);
        throw err;
      }
      return res;
    },
    [refresh, toLogin, toast],
  );

  const request = useCallback(
    async <T,>(path: string, opts: RequestOptions = {}): Promise<T> => {
      const res = await requestRaw(path, opts);
      if (!res.ok) throw await toApiError(res);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
    [requestRaw],
  ) as AdminRequest;

  const logout = useCallback(async () => {
    try {
      await rawRequest("auth/logout", { method: "POST" }, csrf.current);
    } catch {
      /* best effort: the cookie expires on its own */
    }
    leaving.current = true;
    // Hard navigation on purpose: drops all in-memory session state (CSRF, caches).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/admin/login");
  }, []);

  const can = useCallback((...need: Permission[]) => canFn(permissions, ...need), [permissions]);
  const canAny = useCallback((...need: Permission[]) => canAnyFn(permissions, ...need), [permissions]);

  const value = useMemo<SessionCtx>(
    () => ({
      status: "authed",
      user,
      permissions,
      can,
      canAny,
      request,
      requestRaw,
      setSession,
      updateUser: setUser,
      refresh,
      logout,
    }),
    [user, permissions, can, canAny, request, requestRaw, setSession, refresh, logout],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

/** Thai message for any error ("" for aborted requests: show nothing). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429 && err.retryAfter) {
      return `${err.message} (ลองใหม่ได้ในอีก ${err.retryAfter} วินาที)`;
    }
    return err.message;
  }
  if (err instanceof DOMException && err.name === "AbortError") return "";
  return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
}

/** true when the session layer already toasted this error (skip a second toast). */
export function alreadyNotified(err: unknown): boolean {
  return err instanceof ApiError && err.notified;
}
