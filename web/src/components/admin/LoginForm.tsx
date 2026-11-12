"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { ApiError, rawRequest, toApiError } from "@/lib/admin/client";
import type { SessionPayload } from "@/lib/admin/types";
import { errorMessage, useAdmin } from "./SessionProvider";

/** Only same-app admin paths; blocks //evil.com and other open redirects. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/admin") || raw.startsWith("//") || raw.startsWith("/admin/login")) return "/admin";
  return /^\/admin(\/[A-Za-z0-9._~\-/]*)?$/.test(raw) ? raw : "/admin";
}

export function LoginForm() {
  const { status, setSession } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === "authed") router.replace(next);
  }, [status, next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const fe: Record<string, string> = {};
    if (!email.trim()) fe.email = "กรุณากรอกอีเมล";
    if (!password) fe.password = "กรุณากรอกรหัสผ่าน";
    if (Object.keys(fe).length) {
      setFieldErrors(fe);
      return;
    }
    setBusy(true);
    try {
      const res = await rawRequest("auth/login", { method: "POST", json: { email: email.trim(), password } }, null);
      if (!res.ok) throw await toApiError(res);
      const json = (await res.json()) as { data: SessionPayload };
      setSession(json.data);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError(
            err.retryAfter
              ? `พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ ${Math.ceil(err.retryAfter / 60)} นาทีแล้วลองใหม่`
              : "พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
          );
        } else if (err.status === 401) {
          setError(err.message || "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        } else if (err.status === 422) {
          setFieldErrors(err.fields);
          setError(err.message);
        } else {
          setError(err.message);
        }
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <LogoMark className="h-6 w-auto" />
          <span className="font-display font-semibold tracking-wide">ECOMACROBIZ</span>
          <span className="adm-badge">Admin</span>
        </div>
        <form onSubmit={onSubmit} noValidate className="adm-card space-y-4 p-6" aria-describedby={error ? "login-error" : undefined}>
          <div>
            <h1 className="text-xl font-semibold thai-heading">เข้าสู่ระบบผู้ดูแล</h1>
            <p className="text-sm text-muted">Admin sign in</p>
          </div>
          {error ? (
            <p id="login-error" className="adm-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <label htmlFor="login-email" className="adm-label">
              อีเมล (Email)
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              inputMode="email"
              className="adm-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "login-email-err" : undefined}
              autoFocus
            />
            {fieldErrors.email ? (
              <p id="login-email-err" className="adm-field-error">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="login-password" className="adm-label">
              รหัสผ่าน (Password)
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              className="adm-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "login-password-err" : undefined}
            />
            {fieldErrors.password ? (
              <p id="login-password-err" className="adm-field-error">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>
          <button type="submit" className="adm-btn adm-btn-primary w-full" disabled={busy}>
            {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
}
