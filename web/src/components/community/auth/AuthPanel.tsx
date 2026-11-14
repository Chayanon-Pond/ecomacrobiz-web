"use client";

/**
 * Sign-in / register / forgot-password forms. Rendered inside the auth
 * modal and inline on /account (logged out). Google first (when enabled),
 * then the e-mail forms. On success it calls setSession() and onSuccess.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { communityJson, CommunityError } from "@/lib/community/client";
import { savePendingAction, setSession } from "@/lib/community/session";
import type { Me, PendingAction, Session } from "@/lib/community/types";
import { passwordProblem } from "@/lib/community/password";
import { cleanDisplayName, displayNameProblem, emailProblem, normalizeEmail } from "@/lib/community/validation";
import { consentCopy } from "@/content/community";
import { currentNextPath, formatWait, googleStartUrl } from "./auth-urls";
import { turnstileEnabled, useCommunityConfig } from "./config";
import { Alert, FieldError, PasswordField, SubmitButton, TextField } from "./fields";
import { ConsentText, GoogleButton, OrDivider } from "./GoogleButton";
import { Turnstile } from "./Turnstile";

export type AuthTab = "login" | "register";
export type AuthSuccessInfo = { registered: boolean; verificationSent: boolean };

type Errors = Record<string, string | null | undefined>;

const NETWORK_ERROR = "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
const FORGOT_DONE =
  "หากอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงโฟลเดอร์สแปม) ลิงก์มีอายุ 1 ชั่วโมง";

/** Seconds left of a Retry-After wait (ticks every second, 0 = none). */
function useCountdown(): [number, (secs: number) => void] {
  const [left, setLeft] = useState(0);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);
  const start = (secs: number) => {
    if (timer.current) window.clearInterval(timer.current);
    const until = Date.now() + secs * 1000;
    setLeft(Math.ceil(secs));
    timer.current = window.setInterval(() => {
      const s = Math.ceil((until - Date.now()) / 1000);
      if (s <= 0) {
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        setLeft(0);
      } else setLeft(s);
    }, 1000);
  };
  return [left, start];
}

function rateLimitText(left: number) {
  return `ทำรายการถี่เกินไป กรุณารอ ${formatWait(left)} แล้วลองใหม่`;
}

export function AuthPanel({
  initialTab = "login",
  initialView = "tabs",
  pending,
  googleNext,
  onSuccess,
  autoFocus = false,
  headingLevel = "h3",
}: {
  initialTab?: AuthTab;
  /** "forgot" opens the forgot-password form (links from expired reset/link pages). */
  initialView?: "tabs" | "forgot";
  pending?: PendingAction;
  /** Where the Google round-trip returns (default: the current page). */
  googleNext?: string;
  onSuccess: (me: Me, info: AuthSuccessInfo) => void;
  /** Focus the first field on mount (fine pointers only; avoids the phone keyboard popping up). */
  autoFocus?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const config = useCommunityConfig();
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [view, setView] = useState<"tabs" | "forgot">(initialView);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const loginRef = useRef<HTMLButtonElement>(null);
  const registerRef = useRef<HTMLButtonElement>(null);
  const H = headingLevel;

  const startGoogle = () => {
    if (pending) savePendingAction(pending);
    const next = googleNext ?? currentNextPath(window.location);
    window.location.assign(googleStartUrl(next, true));
  };

  const selectTab = (t: AuthTab, focus = false) => {
    setTab(t);
    setNotice(null);
    if (focus) (t === "login" ? loginRef : registerRef).current?.focus();
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Home") return selectTab("login", true);
    if (e.key === "End") return selectTab("register", true);
    selectTab(tab === "login" ? "register" : "login", true);
  };

  if (view === "forgot") {
    return (
      <ForgotForm
        uid={uid}
        email={email}
        setEmail={setEmail}
        transport={config?.email_transport ?? true}
        onBack={() => {
          setView("tabs");
          setTab("login");
        }}
        heading={H}
        autoFocus={autoFocus}
      />
    );
  }

  const tabCls = "ca-tab inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-[0.95rem] font-medium transition-colors";

  return (
    <div>
      {config?.google_enabled && (
        <>
          <GoogleButton onStart={startGoogle} />
          <OrDivider />
        </>
      )}

      <div role="tablist" aria-label="เลือกวิธีใช้งาน" className="flex gap-1 rounded-full border border-line bg-ink-2 p-1">
        <button
          ref={loginRef}
          type="button"
          role="tab"
          id={`${uid}-tab-login`}
          aria-selected={tab === "login"}
          aria-controls={`${uid}-panel-login`}
          tabIndex={tab === "login" ? 0 : -1}
          onClick={() => selectTab("login")}
          onKeyDown={onTabKey}
          className={tabCls}
        >
          เข้าสู่ระบบ
        </button>
        <button
          ref={registerRef}
          type="button"
          role="tab"
          id={`${uid}-tab-register`}
          aria-selected={tab === "register"}
          aria-controls={`${uid}-panel-register`}
          tabIndex={tab === "register" ? 0 : -1}
          onClick={() => selectTab("register")}
          onKeyDown={onTabKey}
          className={tabCls}
        >
          สมัครสมาชิก
        </button>
      </div>

      {notice && (
        <Alert tone="info" className="mt-4">
          {notice}
        </Alert>
      )}

      <div
        role="tabpanel"
        id={`${uid}-panel-${tab}`}
        aria-labelledby={`${uid}-tab-${tab}`}
        className="pt-5"
      >
        {tab === "login" ? (
          <LoginForm
            key="login"
            uid={uid}
            email={email}
            setEmail={setEmail}
            turnstileOn={turnstileEnabled(config)}
            onForgot={() => setView("forgot")}
            onSuccess={onSuccess}
            autoFocus={autoFocus}
          />
        ) : (
          <RegisterForm
            key="register"
            uid={uid}
            email={email}
            setEmail={setEmail}
            config={config}
            onSuccess={onSuccess}
            onEmailTaken={() => {
              setTab("login");
              setNotice("อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน หรือดำเนินการต่อด้วย Google");
            }}
            autoFocus={autoFocus}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ login */

function LoginForm({
  uid,
  email,
  setEmail,
  turnstileOn,
  onForgot,
  onSuccess,
  autoFocus,
}: {
  uid: string;
  email: string;
  setEmail: (v: string) => void;
  turnstileOn: boolean;
  onForgot: () => void;
  onSuccess: (me: Me, info: AuthSuccessInfo) => void;
  autoFocus: boolean;
}) {
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wait, startWait] = useCountdown();
  const [needHuman, setNeedHuman] = useState(false);
  const [human, setHuman] = useState("");
  const [humanReset, setHumanReset] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    (email ? pwRef : emailRef).current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || wait > 0) return;
    const next: Errors = { email: emailProblem(email), password: password ? null : "กรุณากรอกรหัสผ่าน" };
    setErrors(next);
    if (next.email || next.password) {
      (next.email ? emailRef : pwRef).current?.focus();
      return;
    }
    setFormError(null);
    setLoading(true);
    try {
      const s = await communityJson<Session>("auth/login", {
        method: "POST",
        json: { email: normalizeEmail(email), password, ...(human ? { turnstile_token: human } : {}) },
      });
      setSession(s);
      onSuccess(s.member, { registered: false, verificationSent: false });
    } catch (err) {
      setLoading(false);
      if (!(err instanceof CommunityError)) return setFormError(NETWORK_ERROR);
      if (human) setHumanReset((n) => n + 1);
      if (err.status === 429) {
        startWait(err.retryAfter ?? 60);
        return setFormError(null);
      }
      if (err.fields.turnstile_token && turnstileOn) {
        setNeedHuman(true);
        return setFormError("กรุณายืนยันว่าคุณไม่ใช่บอท แล้วกดเข้าสู่ระบบอีกครั้ง");
      }
      if (err.status === 422 && (err.fields.email || err.fields.password)) {
        setErrors({ email: err.fields.email, password: err.fields.password });
        return;
      }
      setFormError(err.message);
      if (err.code === "invalid_credentials") {
        setPassword("");
        pwRef.current?.focus();
      }
    }
  };

  return (
    <form noValidate onSubmit={submit} aria-busy={loading} className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}
      {wait > 0 && <Alert>{rateLimitText(wait)}</Alert>}
      <TextField
        ref={emailRef}
        id={`${uid}-login-email`}
        label="อีเมล"
        type="email"
        inputMode="email"
        autoComplete="username email"
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
        id={`${uid}-login-password`}
        label="รหัสผ่าน"
        autoComplete="current-password"
        maxLength={256}
        required
        value={password}
        onValue={(v) => {
          setPassword(v);
          if (errors.password && v) setErrors((x) => ({ ...x, password: null }));
        }}
        error={errors.password}
        aside={
          <button type="button" onClick={onForgot} className="inline-flex min-h-8 items-center text-sm text-accent-soft underline-offset-4 hover:underline">
            ลืมรหัสผ่าน?
          </button>
        }
      />
      {needHuman && <Turnstile onToken={setHuman} resetKey={humanReset} />}
      <SubmitButton loading={loading} disabled={wait > 0 || (needHuman && !human)} className="mt-1 w-full" loadingText="กำลังเข้าสู่ระบบ…">
        เข้าสู่ระบบ
      </SubmitButton>
    </form>
  );
}

/* --------------------------------------------------------------- register */

function RegisterForm({
  uid,
  email,
  setEmail,
  config,
  onSuccess,
  onEmailTaken,
  autoFocus,
}: {
  uid: string;
  email: string;
  setEmail: (v: string) => void;
  config: ReturnType<typeof useCommunityConfig>;
  onSuccess: (me: Me, info: AuthSuccessInfo) => void;
  onEmailTaken: () => void;
  autoFocus: boolean;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wait, startWait] = useCountdown();
  const [human, setHuman] = useState("");
  const [humanReset, setHumanReset] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const needHuman = turnstileEnabled(config);
  const ctx = { email, displayName: cleanDisplayName(name) };

  useEffect(() => {
    if (autoFocus) nameRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = (): Errors => ({
    display_name: displayNameProblem(name),
    email: emailProblem(email),
    password: passwordProblem(password, ctx),
    accept_terms: consent ? null : "กรุณายอมรับแนวปฏิบัติของชุมชนและข้อกำหนดการใช้งานก่อนสมัครสมาชิก",
  });

  const focusFirst = (errs: Errors) => {
    const order: [string, React.RefObject<HTMLInputElement | null>][] = [
      ["display_name", nameRef],
      ["email", emailRef],
      ["password", pwRef],
      ["accept_terms", consentRef],
    ];
    order.find(([k]) => errs[k])?.[1].current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || wait > 0) return;
    const errs = validate();
    setErrors(errs);
    setTaken(false);
    if (Object.values(errs).some(Boolean)) return focusFirst(errs);
    if (!config) return setFormError("ไม่สามารถโหลดการตั้งค่าได้ กรุณาลองใหม่อีกครั้ง");
    setFormError(null);
    setLoading(true);
    try {
      const s = await communityJson<Session>("auth/register", {
        method: "POST",
        json: {
          display_name: cleanDisplayName(name),
          email: normalizeEmail(email),
          password,
          accept_terms: true,
          consent_version: config.consent_version,
          website,
          ...(human ? { turnstile_token: human } : {}),
        },
      });
      setSession(s);
      onSuccess(s.member, { registered: true, verificationSent: config.email_transport });
    } catch (err) {
      setLoading(false);
      if (human) setHumanReset((n) => n + 1);
      if (!(err instanceof CommunityError)) return setFormError(NETWORK_ERROR);
      if (err.status === 429) return startWait(err.retryAfter ?? 60);
      if (err.code === "email_taken") {
        setTaken(true);
        setErrors((x) => ({ ...x, email: err.message }));
        emailRef.current?.focus();
        return;
      }
      const f = err.fields;
      if (err.status === 422 && Object.keys(f).length) {
        const next: Errors = { display_name: f.display_name, email: f.email, password: f.password, accept_terms: f.accept_terms };
        setErrors(next);
        if (f.turnstile_token) setFormError(f.turnstile_token);
        else if (f.accept_terms && consent) setFormError("ข้อกำหนดมีการปรับปรุง กรุณารีเฟรชหน้าแล้วลองใหม่");
        focusFirst(next);
        return;
      }
      setFormError(err.message);
    }
  };

  const consentId = `${uid}-reg-consent`;

  return (
    <form noValidate onSubmit={submit} aria-busy={loading} className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}
      {wait > 0 && <Alert>{rateLimitText(wait)}</Alert>}
      <TextField
        ref={nameRef}
        id={`${uid}-reg-name`}
        label="ชื่อที่แสดง"
        autoComplete="nickname"
        maxLength={60}
        required
        value={name}
        onValue={(v) => {
          setName(v);
          if (errors.display_name) setErrors((x) => ({ ...x, display_name: displayNameProblem(v) }));
        }}
        onBlur={() => name && setErrors((x) => ({ ...x, display_name: displayNameProblem(name) }))}
        error={errors.display_name}
        hint="ชื่อนี้จะแสดงต่อสาธารณะในความคิดเห็นของคุณ (2–40 ตัวอักษร)"
      />
      <div>
        <TextField
          ref={emailRef}
          id={`${uid}-reg-email`}
          label="อีเมล"
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
            setTaken(false);
            if (errors.email) setErrors((x) => ({ ...x, email: emailProblem(v) }));
          }}
          onBlur={() => email && !taken && setErrors((x) => ({ ...x, email: emailProblem(email) }))}
          error={errors.email}
          hint="ไม่แสดงต่อสาธารณะ"
        />
        {taken && (
          <button type="button" onClick={onEmailTaken} className="mt-1 inline-flex min-h-10 items-center text-sm font-medium text-accent-soft underline underline-offset-4">
            เข้าสู่ระบบด้วยอีเมลนี้
          </button>
        )}
      </div>
      <PasswordField
        ref={pwRef}
        id={`${uid}-reg-password`}
        label="รหัสผ่าน"
        autoComplete="new-password"
        maxLength={128}
        required
        meter
        context={ctx}
        value={password}
        onValue={(v) => {
          setPassword(v);
          if (errors.password) setErrors((x) => ({ ...x, password: passwordProblem(v, { email, displayName: cleanDisplayName(name) }) }));
        }}
        onBlur={() => password && setErrors((x) => ({ ...x, password: passwordProblem(password, ctx) }))}
        error={errors.password}
      />

      {/* Honeypot: invisible to people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="ca-hp">
        <label htmlFor={`${uid}-reg-website`}>เว็บไซต์ (ไม่ต้องกรอก)</label>
        <input id={`${uid}-reg-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <div>
        <div className="flex items-start gap-3">
          <input
            ref={consentRef}
            id={consentId}
            type="checkbox"
            required
            aria-required="true"
            aria-invalid={errors.accept_terms ? true : undefined}
            aria-describedby={errors.accept_terms ? `${consentId}-error` : undefined}
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) setErrors((x) => ({ ...x, accept_terms: null }));
            }}
            className="ca-check mt-1 size-5 shrink-0 cursor-pointer"
          />
          <label htmlFor={consentId} className="text-sm leading-6 text-muted">
            <ConsentText copy={consentCopy.checkboxLabel} />
            <span className="sr-only"> (จำเป็น)</span>
          </label>
        </div>
        <FieldError id={consentId} message={errors.accept_terms} />
      </div>

      {needHuman && <Turnstile onToken={setHuman} resetKey={humanReset} />}

      <SubmitButton loading={loading} disabled={wait > 0 || (needHuman && !human)} className="mt-1 w-full" loadingText="กำลังสมัครสมาชิก…">
        สมัครสมาชิก
      </SubmitButton>
    </form>
  );
}

/* ---------------------------------------------------------------- forgot */

function ForgotForm({
  uid,
  email,
  setEmail,
  transport,
  onBack,
  heading: H,
  autoFocus,
}: {
  uid: string;
  email: string;
  setEmail: (v: string) => void;
  transport: boolean;
  onBack: () => void;
  heading: "h2" | "h3";
  autoFocus: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wait, startWait] = useCountdown();
  const ref = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
    else headRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || wait > 0) return;
    const p = emailProblem(email);
    setError(p);
    if (p) return ref.current?.focus();
    setFormError(null);
    setLoading(true);
    try {
      await communityJson<null>("auth/password/forgot", { method: "POST", json: { email: normalizeEmail(email) } });
      setDone(true);
    } catch (err) {
      if (err instanceof CommunityError && err.status === 429) startWait(err.retryAfter ?? 60);
      else if (err instanceof CommunityError && err.status === 422) setError(err.fields.email ?? err.message);
      else setFormError(err instanceof CommunityError ? err.message : NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted transition-colors hover:text-fg">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3 5 8l5 5" />
        </svg>
        กลับไปหน้าเข้าสู่ระบบ
      </button>
      <H ref={headRef} tabIndex={-1} className="thai-heading text-lg font-semibold outline-none">
        ลืมรหัสผ่าน
      </H>
      {done ? (
        <div className="mt-4 flex flex-col gap-4">
          <Alert tone="success">{FORGOT_DONE}</Alert>
          {!transport && <p className="text-sm leading-6 text-subtle">หมายเหตุ: ขณะนี้ระบบส่งอีเมลของเว็บไซต์ยังไม่เปิดใช้งาน หากไม่ได้รับอีเมล กรุณาติดต่อเรา</p>}
          <button type="button" onClick={onBack} className="ca-btn ca-btn-ghost w-full">
            กลับไปหน้าเข้าสู่ระบบ
          </button>
        </div>
      ) : (
        <form noValidate onSubmit={submit} aria-busy={loading} className="mt-2 flex flex-col gap-4">
          <p className="text-sm leading-6 text-muted">กรอกอีเมลที่ใช้สมัครสมาชิก เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้</p>
          {formError && <Alert>{formError}</Alert>}
          {wait > 0 && <Alert>{rateLimitText(wait)}</Alert>}
          <TextField
            ref={ref}
            id={`${uid}-forgot-email`}
            label="อีเมล"
            type="email"
            inputMode="email"
            autoComplete="username email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            value={email}
            onValue={(v) => {
              setEmail(v);
              if (error) setError(emailProblem(v));
            }}
            onBlur={() => email && setError(emailProblem(email))}
            error={error}
          />
          <SubmitButton loading={loading} disabled={wait > 0} className="w-full" loadingText="กำลังส่ง…">
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
