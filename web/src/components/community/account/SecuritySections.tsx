"use client";

/** Account tabs: อีเมล, รหัสผ่าน, การเชื่อมต่อ. */
import { useRef, useState, type FormEvent } from "react";
import { communityJson, CommunityError } from "@/lib/community/client";
import { loadSession, setMe } from "@/lib/community/session";
import type { CommunityConfig, Me } from "@/lib/community/types";
import { PASSWORD_MESSAGES, passwordProblem } from "@/lib/community/password";
import { emailProblem, normalizeEmail } from "@/lib/community/validation";
import { formatWait, googleStartUrl } from "../auth/auth-urls";
import { Alert, PasswordField, SubmitButton, TextField } from "../auth/fields";
import { GoogleMark } from "../auth/GoogleButton";
import { formatDate, Section } from "./ui";

type Msg = { tone: "error" | "success" | "info"; text: string } | null;

function errText(err: unknown): string {
  if (err instanceof CommunityError && err.status === 429 && err.retryAfter) {
    return `ทำรายการถี่เกินไป กรุณารอ ${formatWait(err.retryAfter)} แล้วลองใหม่`;
  }
  return err instanceof CommunityError ? err.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(40_180_110/0.15)] px-2.5 py-0.5 text-xs font-medium text-[#9ff0c2]">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
      ยืนยันแล้ว
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-[rgb(255_180_60/0.14)] px-2.5 py-0.5 text-xs font-medium text-[#ffd59a]">ยังไม่ยืนยัน</span>
  );
}

/* ------------------------------------------------------------------ email */

export function EmailSection({
  me,
  config,
  onGoToPassword,
}: {
  me: Me;
  config: CommunityConfig | null | undefined;
  onGoToPassword: () => void;
}) {
  const transport = config?.email_transport ?? false;
  const [resend, setResend] = useState<Msg>(null);
  const [resending, setResending] = useState(false);

  const doResend = async () => {
    setResending(true);
    setResend(null);
    try {
      await communityJson<null>("auth/verify-email/resend", { method: "POST" });
      setResend({ tone: "success", text: `ส่งลิงก์ยืนยันไปที่ ${me.email} แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงโฟลเดอร์สแปม)` });
    } catch (err) {
      setResend({ tone: "error", text: errText(err) });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="อีเมลปัจจุบัน" description="ใช้สำหรับเข้าสู่ระบบและรับลิงก์ยืนยัน ไม่แสดงต่อสาธารณะ">
        <div className="flex flex-wrap items-center gap-3">
          <span className="break-all font-medium">{me.email}</span>
          <VerifiedBadge verified={me.email_verified} />
        </div>
        {!me.email_verified && (
          <div className="mt-4 flex flex-col gap-3">
            {resend && <Alert tone={resend.tone === "info" ? "info" : resend.tone}>{resend.text}</Alert>}
            {transport ? (
              <button type="button" onClick={doResend} disabled={resending} className="ca-btn ca-btn-ghost self-start">
                {resending ? "กำลังส่ง…" : "ส่งลิงก์ยืนยันอีกครั้ง"}
              </button>
            ) : (
              <p className="text-sm leading-6 text-subtle">ขณะนี้ระบบส่งอีเมลยืนยันยังไม่เปิดใช้งาน คุณยังใช้งานบัญชีได้ตามปกติ</p>
            )}
          </div>
        )}
      </Section>
      <Section
        title="เปลี่ยนอีเมล"
        description={
          transport
            ? "เราจะส่งลิงก์ยืนยันไปที่อีเมลใหม่ อีเมลของบัญชีจะเปลี่ยนเมื่อคุณกดลิงก์นั้น"
            : "อีเมลจะเปลี่ยนทันที และจะอยู่ในสถานะยังไม่ยืนยัน"
        }
      >
        {me.has_password ? (
          <ChangeEmailForm me={me} />
        ) : (
          <div className="flex flex-col gap-4">
            <Alert tone="info">บัญชีนี้เข้าสู่ระบบด้วย Google เท่านั้น กรุณาตั้งรหัสผ่านก่อนเปลี่ยนอีเมล เพื่อยืนยันว่าเป็นเจ้าของบัญชี</Alert>
            <button type="button" onClick={onGoToPassword} className="ca-btn ca-btn-ghost self-start">
              ไปที่ตั้งรหัสผ่าน
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

function ChangeEmailForm({ me }: { me: Me }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let ep = emailProblem(email);
    if (!ep && normalizeEmail(email) === normalizeEmail(me.email)) ep = "อีเมลใหม่ต้องไม่ซ้ำกับอีเมลปัจจุบัน";
    const next = { email: ep, password: password ? null : "กรุณากรอกรหัสผ่านปัจจุบัน" };
    setErrors(next);
    setMsg(null);
    if (next.email || next.password) return (next.email ? emailRef : pwRef).current?.focus();
    setLoading(true);
    try {
      const res = await communityJson<{ member: Me; verification_sent: boolean }>("account/email", {
        method: "PUT",
        json: { new_email: normalizeEmail(email), current_password: password },
      });
      setMe(res.member);
      setMsg({
        tone: "success",
        text: res.verification_sent
          ? `เราส่งลิงก์ยืนยันไปที่ ${normalizeEmail(email)} แล้ว อีเมลของบัญชีจะเปลี่ยนเมื่อคุณกดลิงก์นั้น`
          : "เปลี่ยนอีเมลเรียบร้อย",
      });
      setEmail("");
      setPassword("");
    } catch (err) {
      if (err instanceof CommunityError) {
        if (err.code === "email_taken") return setErrors({ email: err.message });
        if (err.code === "invalid_credentials") return setErrors({ password: "รหัสผ่านไม่ถูกต้อง" });
        if (err.fields.new_email || err.fields.current_password) {
          return setErrors({ email: err.fields.new_email, password: err.fields.current_password });
        }
      }
      setMsg({ tone: "error", text: errText(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={loading}>
      {msg && <Alert tone={msg.tone === "info" ? "info" : msg.tone}>{msg.text}</Alert>}
      <TextField
        ref={emailRef}
        id="acc-new-email"
        label="อีเมลใหม่"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        required
        value={email}
        onValue={(v) => {
          setEmail(v);
          if (errors.email) setErrors((x) => ({ ...x, email: emailProblem(v) }));
        }}
        onBlur={() => email && setErrors((x) => ({ ...x, email: emailProblem(email) }))}
        error={errors.email}
      />
      <PasswordField
        ref={pwRef}
        id="acc-email-password"
        label="รหัสผ่านปัจจุบัน"
        autoComplete="current-password"
        required
        value={password}
        onValue={(v) => {
          setPassword(v);
          if (errors.password && v) setErrors((x) => ({ ...x, password: null }));
        }}
        error={errors.password}
      />
      <SubmitButton loading={loading} className="self-start" loadingText="กำลังบันทึก…">
        เปลี่ยนอีเมล
      </SubmitButton>
    </form>
  );
}

/* --------------------------------------------------------------- password */

export function PasswordSection({ me }: { me: Me }) {
  const setting = !me.has_password;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null | undefined>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [loading, setLoading] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const ctx = { email: me.email, displayName: me.display_name };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = {
      current: !setting && !current ? "กรุณากรอกรหัสผ่านปัจจุบัน" : null,
      next: passwordProblem(next, ctx),
      confirm: confirm !== next ? PASSWORD_MESSAGES.mismatch : null,
    };
    setErrors(errs);
    setMsg(null);
    const first = (["current", "next", "confirm"] as const).find((k) => errs[k]);
    if (first) return { current: currentRef, next: nextRef, confirm: confirmRef }[first].current?.focus();
    setLoading(true);
    try {
      await communityJson<null>("account/password", {
        method: "PUT",
        json: setting ? { new_password: next } : { current_password: current, new_password: next },
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      await loadSession(true);
      setMsg({
        tone: "success",
        text: setting
          ? "ตั้งรหัสผ่านเรียบร้อย ตอนนี้คุณเข้าสู่ระบบด้วยอีเมลและรหัสผ่านได้แล้ว"
          : "เปลี่ยนรหัสผ่านเรียบร้อย อุปกรณ์อื่นที่เคยเข้าสู่ระบบไว้ถูกออกจากระบบแล้ว",
      });
    } catch (err) {
      if (err instanceof CommunityError) {
        if (err.code === "invalid_credentials") {
          setErrors({ current: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
          return currentRef.current?.focus();
        }
        if (err.fields.current_password || err.fields.new_password) {
          return setErrors({ current: err.fields.current_password, next: err.fields.new_password });
        }
      }
      setMsg({ tone: "error", text: errText(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section
      title={setting ? "ตั้งรหัสผ่าน" : "เปลี่ยนรหัสผ่าน"}
      description={
        setting
          ? "บัญชีนี้ยังไม่มีรหัสผ่าน (เข้าสู่ระบบด้วย Google) ตั้งรหัสผ่านเพื่อเข้าสู่ระบบด้วยอีเมลได้ และเพื่อเปลี่ยนอีเมลหรือยกเลิกการเชื่อมต่อ Google"
          : "เมื่อเปลี่ยนรหัสผ่าน อุปกรณ์อื่นทั้งหมดจะถูกออกจากระบบ"
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={loading}>
        {msg && <Alert tone={msg.tone === "info" ? "info" : msg.tone}>{msg.text}</Alert>}
        {/* Lets password managers attach the new password to the right account. */}
        <input type="email" name="username" autoComplete="username" value={me.email} readOnly hidden />
        {!setting && (
          <PasswordField
            ref={currentRef}
            id="acc-pw-current"
            label="รหัสผ่านปัจจุบัน"
            autoComplete="current-password"
            required
            value={current}
            onValue={(v) => {
              setCurrent(v);
              if (errors.current && v) setErrors((x) => ({ ...x, current: null }));
            }}
            error={errors.current}
          />
        )}
        <PasswordField
          ref={nextRef}
          id="acc-pw-new"
          label="รหัสผ่านใหม่"
          autoComplete="new-password"
          maxLength={128}
          required
          meter
          context={ctx}
          value={next}
          onValue={(v) => {
            setNext(v);
            if (errors.next) setErrors((x) => ({ ...x, next: passwordProblem(v, ctx) }));
          }}
          onBlur={() => next && setErrors((x) => ({ ...x, next: passwordProblem(next, ctx) }))}
          error={errors.next}
        />
        <PasswordField
          ref={confirmRef}
          id="acc-pw-confirm"
          label="ยืนยันรหัสผ่านใหม่"
          autoComplete="new-password"
          maxLength={128}
          required
          value={confirm}
          onValue={(v) => {
            setConfirm(v);
            if (errors.confirm) setErrors((x) => ({ ...x, confirm: v !== next ? PASSWORD_MESSAGES.mismatch : null }));
          }}
          onBlur={() => confirm && setErrors((x) => ({ ...x, confirm: confirm !== next ? PASSWORD_MESSAGES.mismatch : null }))}
          error={errors.confirm}
        />
        <SubmitButton loading={loading} className="self-start" loadingText="กำลังบันทึก…">
          {setting ? "ตั้งรหัสผ่าน" : "เปลี่ยนรหัสผ่าน"}
        </SubmitButton>
      </form>
    </Section>
  );
}

/* ------------------------------------------------------------ connections */

export function ConnectionsSection({
  me,
  config,
  onGoToPassword,
}: {
  me: Me;
  config: CommunityConfig | null | undefined;
  onGoToPassword: () => void;
}) {
  const google = me.identities.find((i) => i.provider === "google");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const connect = () => {
    setBusy(true);
    // consent=false: a Google account with a different e-mail must not create a second member.
    window.location.assign(googleStartUrl("/account?tab=connections", false));
  };

  const unlink = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await communityJson<null>("account/identities/google", { method: "DELETE" });
      await loadSession(true);
      setConfirming(false);
      setMsg({ tone: "success", text: "ยกเลิกการเชื่อมต่อ Google แล้ว" });
    } catch (err) {
      setMsg({ tone: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="บัญชีที่เชื่อมต่อ" description="ใช้บัญชีเหล่านี้เข้าสู่ระบบแทนรหัสผ่านได้">
      {msg && (
        <Alert tone={msg.tone === "info" ? "info" : msg.tone} className="mb-4">
          {msg.text}
        </Alert>
      )}
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-ink-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white">
            <GoogleMark className="size-5" />
          </span>
          <div>
            <p className="font-medium">Google</p>
            <p className="text-sm text-muted">{google ? `เชื่อมต่อเมื่อ ${formatDate(google.created_at)}` : "ยังไม่ได้เชื่อมต่อ"}</p>
          </div>
        </div>
        {google ? (
          me.has_password ? (
            confirming ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={unlink} disabled={busy} className="ca-btn ca-btn-danger">
                  {busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="ca-btn ca-btn-ghost">
                  ไม่ใช่ตอนนี้
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="ca-btn ca-btn-ghost">
                ยกเลิกการเชื่อมต่อ
              </button>
            )
          ) : (
            <button type="button" disabled aria-describedby="acc-unlink-why" className="ca-btn ca-btn-ghost">
              ยกเลิกการเชื่อมต่อ
            </button>
          )
        ) : config?.google_enabled ? (
          <button type="button" onClick={connect} disabled={busy} className="ca-google sm:w-auto sm:px-5">
            <GoogleMark />
            <span>{busy ? "กำลังไปที่ Google…" : "เชื่อมต่อ Google"}</span>
          </button>
        ) : (
          <p className="text-sm text-subtle">ขณะนี้ยังไม่เปิดให้เชื่อมต่อ Google</p>
        )}
      </div>
      {google && !me.has_password && (
        <div id="acc-unlink-why" className="mt-4 flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted">Google เป็นช่องทางเข้าสู่ระบบเดียวของบัญชีนี้ ต้องตั้งรหัสผ่านก่อนจึงจะยกเลิกการเชื่อมต่อได้</p>
          <button type="button" onClick={onGoToPassword} className="ca-btn ca-btn-ghost self-start">
            ไปที่ตั้งรหัสผ่าน
          </button>
        </div>
      )}
      {!google && config?.google_enabled && (
        <p className="mt-4 text-sm leading-6 text-subtle">
          ใช้บัญชี Google ที่มีอีเมลเดียวกับบัญชีนี้ ({me.email}) หากอีเมลไม่ตรงกัน ระบบจะไม่เชื่อมต่อให้
        </p>
      )}
    </Section>
  );
}
