/**
 * Server-only session verification for the protected admin console
 * (app/admin/(console)/layout.tsx). Calls the Go API's /auth/me with the
 * visitor's cookie; never cached. Must run inside <Suspense> (reads
 * cookies()/headers()).
 */
import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { ADMIN_COOKIE } from "./proxy";
import type { SessionPayload } from "./types";

const ME_TIMEOUT_MS = 5_000;

export type SessionCheck =
  | { kind: "ok"; session: SessionPayload }
  | { kind: "unauth"; next: string }
  | { kind: "error"; next: string; message: string };

export async function checkAdminSession(): Promise<SessionCheck> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const next = h.get("x-admin-path") ?? "/admin";
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return { kind: "unauth", next };

  const base = process.env.API_URL?.trim().replace(/\/+$/, "");
  if (!base) return { kind: "error", next, message: "ระบบหลังบ้านยังไม่ได้ตั้งค่า (API_URL)" };

  const fwd = new Headers({ accept: "application/json", cookie: `${ADMIN_COOKIE}=${token}` });
  const ua = h.get("user-agent");
  if (ua) fwd.set("user-agent", ua);
  const ip = clientIp(h as unknown as Headers);
  if (ip) fwd.set("x-forwarded-for", ip);

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/admin/auth/me`, {
      headers: fwd,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(ME_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("[admin-session] /auth/me failed", err);
    return {
      kind: "error",
      next,
      message: timedOut ? "เซิร์ฟเวอร์ตอบสนองช้าเกินไป" : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์หลังบ้านได้",
    };
  }

  if (res.status === 401) return { kind: "unauth", next };
  if (!res.ok) {
    console.error("[admin-session] /auth/me status", res.status);
    return { kind: "error", next, message: `เซิร์ฟเวอร์ตอบกลับผิดปกติ (HTTP ${res.status})` };
  }
  try {
    const json = (await res.json()) as { data?: SessionPayload };
    const s = json.data;
    if (!s?.user?.id || !Array.isArray(s.permissions) || typeof s.csrf_token !== "string") {
      return { kind: "error", next, message: "ข้อมูลเซสชันไม่ถูกต้อง" };
    }
    return { kind: "ok", session: s };
  } catch {
    return { kind: "error", next, message: "ข้อมูลเซสชันไม่ถูกต้อง" };
  }
}
