"use client";

import { LogIn, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, rawRequest, toApiError } from "@/lib/admin/client";
import { safeNext } from "@/lib/admin/next-path";
import { AuthFrame } from "./auth/AuthFrame";
import { PasswordInput } from "./auth/PasswordFields";
import { errorMessage } from "./SessionProvider";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Field";

/** Public login page. Honours ?next= (same-origin /admin paths only). */
export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Already signed in (valid cookie)? Skip the form.
  useEffect(() => {
    const ctrl = new AbortController();
    rawRequest("auth/me", { signal: ctrl.signal }, null)
      .then((res) => {
        if (res.ok) window.location.replace(next);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: Record<string, string> = {};
    if (!email.trim()) fe.email = "กรุณากรอกอีเมล";
    if (!password) fe.password = "กรุณากรอกรหัสผ่าน";
    setFieldErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const res = await rawRequest("auth/login", { method: "POST", json: { email: email.trim(), password } }, null);
      if (!res.ok) throw await toApiError(res);
      // Hard navigation so the console layout verifies the new cookie server-side.
      window.location.assign(next);
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
    <AuthFrame footer={<>ลืมรหัสผ่าน? ติดต่อเจ้าของระบบ (Owner) เพื่อขอลิงก์ตั้งรหัสผ่านใหม่</>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-describedby={error ? "login-error" : undefined}>
        <div>
          <h1 className="text-xl font-semibold thai-heading">เข้าสู่ระบบผู้ดูแล</h1>
          <p className="text-sm text-muted">จัดการบทความ รายชื่อผู้ติดต่อ และทีมงาน</p>
        </div>
        {error ? (
          <div id="login-error">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        <Field label="อีเมล" error={fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="username"
              inputMode="email"
              icon={<Mail size={16} aria-hidden="true" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="รหัสผ่าน" error={fieldErrors.password}>
          {(p) => <PasswordInput {...p} value={password} onChange={setPassword} autoComplete="current-password" />}
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={busy}
          loadingText="กำลังเข้าสู่ระบบ…"
          icon={<LogIn size={17} aria-hidden="true" />}
        >
          เข้าสู่ระบบ
        </Button>
      </form>
    </AuthFrame>
  );
}
