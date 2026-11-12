"use client";

/**
 * Admin session (client-side). The session cookie is HttpOnly; the CSRF
 * token lives only in React state (never localStorage) and is re-fetched
 * from /auth/me on load and after a 403.
 */
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, rawRequest, toApiError, type RequestOptions } from "@/lib/admin/client";
import type { AdminUser, SessionPayload } from "@/lib/admin/types";

type Status = "loading" | "authed" | "anon";

export type AdminRequest = <T>(path: string, opts?: RequestOptions) => Promise<T>;

type SessionCtx = {
  status: Status;
  user: AdminUser | null;
  /** JSON request with CSRF, 401 -> login, 403 -> refresh token + retry once. */
  request: AdminRequest;
  /** Same as request but resolves with the raw Response (downloads). */
  requestRaw: (path: string, opts?: RequestOptions) => Promise<Response>;
  setSession: (s: SessionPayload) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

export function useAdmin(): SessionCtx {
  const v = use(Ctx);
  if (!v) throw new Error("useAdmin must be used inside <SessionProvider>");
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AdminUser | null>(null);
  const csrf = useRef<string | null>(null);

  const setSession = useCallback((s: SessionPayload) => {
    csrf.current = s.csrf_token;
    setUser(s.user);
    setStatus("authed");
  }, []);

  // Session gone: <Guard> in AdminShell redirects to /admin/login?next=...
  const toLogin = useCallback(() => {
    csrf.current = null;
    setUser(null);
    setStatus("anon");
  }, []);

  const fetchMe = useCallback(async (): Promise<boolean> => {
    try {
      const res = await rawRequest("auth/me", {}, null);
      if (!res.ok) return false;
      const json = (await res.json()) as { data: SessionPayload };
      setSession(json.data);
      return true;
    } catch {
      return false;
    }
  }, [setSession]);

  useEffect(() => {
    let alive = true;
    rawRequest("auth/me", {}, null)
      .then(async (res) => {
        if (!alive) return;
        if (res.ok) {
          const json = (await res.json()) as { data: SessionPayload };
          if (alive) setSession(json.data);
        } else {
          setStatus("anon");
        }
      })
      .catch(() => alive && setStatus("anon"));
    return () => {
      alive = false;
    };
  }, [setSession]);

  const requestRaw = useCallback(
    async (path: string, opts: RequestOptions = {}): Promise<Response> => {
      let res = await rawRequest(path, opts, csrf.current);
      if (res.status === 403 && (opts.method ?? "GET") !== "GET") {
        // CSRF token may be stale (new session in another tab): refresh once.
        if (await fetchMe()) res = await rawRequest(path, opts, csrf.current);
      }
      if (res.status === 401) {
        toLogin();
        throw await toApiError(res);
      }
      return res;
    },
    [fetchMe, toLogin],
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
    csrf.current = null;
    setUser(null);
    setStatus("anon");
    router.replace("/admin/login");
  }, [router]);

  const value = useMemo(
    () => ({ status, user, request, requestRaw, setSession, logout }),
    [status, user, request, requestRaw, setSession, logout],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

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
