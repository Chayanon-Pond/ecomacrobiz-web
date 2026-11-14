"use client";

/**
 * Form primitives shared by the auth modal, the inline auth form and the
 * account pages: labelled inputs with aria-invalid/aria-describedby wiring,
 * a password field with show/hide (+ optional strength meter and rules),
 * alerts and a submit button with a loading state.
 */
import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { passwordRules, passwordStrength, type PasswordContext } from "@/lib/community/password";
import "./auth.css";

type BaseInput = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "onChange" | "value" | "children">;

export type TextFieldProps = BaseInput & {
  id: string;
  label: ReactNode;
  value: string;
  onValue: (v: string) => void;
  error?: string | null;
  hint?: ReactNode;
  /** Extra element (e.g. a "forgot password" link) rendered in the label row. */
  aside?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

export function describedBy(id: string, hint: boolean, error: boolean, extra?: string): string | undefined {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : "", extra ?? ""].filter(Boolean).join(" ") || undefined;
}

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="ca-error mt-1.5 flex items-start gap-1.5 text-sm leading-6">
      <span aria-hidden="true">!</span>
      <span>{message}</span>
    </p>
  );
}

export function TextField({ ref, id, label, value, onValue, error, hint, aside, required, className, ...rest }: TextFieldProps) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[0.95rem] font-medium text-fg">
          {label}
          {required && <span className="sr-only"> (จำเป็น)</span>}
        </label>
        {aside}
      </div>
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
        className="ca-input"
        {...rest}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm leading-6 text-subtle">
          {hint}
        </p>
      )}
      <FieldError id={id} message={error} />
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, "type"> & {
  /** Show the strength meter + rules checklist (new passwords). */
  meter?: boolean;
  context?: PasswordContext;
};

export function PasswordField({ ref, id, label, value, onValue, error, hint, aside, meter, context, required, className, ...rest }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const strength = meter ? passwordStrength(value, context) : null;
  const rules = meter ? passwordRules(value, context) : [];
  const meterId = `${id}-meter`;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[0.95rem] font-medium text-fg">
          {label}
          {required && <span className="sr-only"> (จำเป็น)</span>}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, Boolean(hint), Boolean(error), meter ? meterId : undefined)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="ca-input pr-14"
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          aria-pressed={shown}
          aria-controls={id}
          className="absolute inset-y-0 right-1 my-auto inline-flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:text-fg"
        >
          <EyeIcon open={shown} />
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm leading-6 text-subtle">
          {hint}
        </p>
      )}
      {meter && strength && (
        <div id={meterId} className="mt-2.5">
          <div className="flex items-center gap-3">
            <div className="ca-meter grid flex-1 grid-cols-5 gap-1" data-score={strength.score} data-empty={value === ""} aria-hidden="true">
              <span className="h-1.5 rounded-full" />
              <span className="h-1.5 rounded-full" />
              <span className="h-1.5 rounded-full" />
              <span className="h-1.5 rounded-full" />
              <span className="h-1.5 rounded-full" />
            </div>
            <p className="min-w-[5.5rem] text-right text-xs text-muted" aria-live="polite">
              {value ? (
                <>
                  <span className="sr-only">ความแข็งแรงของรหัสผ่าน: </span>
                  {strength.label}
                </>
              ) : (
                ""
              )}
            </p>
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {rules.map((r) => (
              <li key={r.id} className={`flex items-center gap-2 ${r.ok ? "ca-ok" : "text-subtle"}`}>
                <span aria-hidden="true" className="inline-flex size-4 items-center justify-center">
                  {r.ok ? (
                    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m3.5 8.5 3 3 6-7" />
                    </svg>
                  ) : (
                    <span className="size-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span>
                  {r.label}
                  <span className="sr-only">{r.ok ? " (ผ่าน)" : " (ยังไม่ผ่าน)"}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <FieldError id={id} message={error} />
    </div>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="ca-spinner inline-block" />;
}

export function SubmitButton({
  loading,
  disabled,
  children,
  variant = "primary",
  className = "",
  loadingText = "กำลังดำเนินการ…",
}: {
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
  loadingText?: string;
}) {
  return (
    <button type="submit" disabled={loading || disabled} aria-disabled={loading || disabled || undefined} className={`ca-btn ca-btn-${variant} ${className}`}>
      {loading ? (
        <>
          <Spinner />
          <span>{loadingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Alert({
  tone = "error",
  children,
  className = "",
  id,
}: {
  tone?: "error" | "info" | "success";
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const cls = tone === "error" ? "ca-alert" : tone === "success" ? "ca-success" : "ca-info";
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} className={`${cls} rounded-2xl px-4 py-3 text-sm leading-6 ${className}`}>
      {children}
    </div>
  );
}
