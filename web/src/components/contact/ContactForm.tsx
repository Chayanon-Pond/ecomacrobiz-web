"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { contactForm as copy } from "@/content/contact";
import {
  CONTACT_FIELD_ORDER,
  CONTACT_LIMITS,
  EMPTY_CONTACT,
  bangkokToday,
  validateContact,
  validateField,
  type ContactErrors,
  type ContactField,
  type ContactFormValues,
} from "@/lib/contact/validation";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string; rateLimited?: boolean };

const noopSubscribe = () => () => {};
const SOURCE_PAGE = "/contact";

function fieldId(name: ContactField) {
  return `cf-${name}`;
}

function waitText(retryAfter: string | null): string {
  const secs = Number(retryAfter);
  if (!Number.isFinite(secs) || secs <= 0) return "สักครู่";
  if (secs < 90) return ` ${Math.ceil(secs)} วินาที`;
  return ` ${Math.ceil(secs / 60)} นาที`;
}

const inputCls =
  "kc-input block w-full min-h-12 rounded-xl border border-line-strong bg-ink-2 px-4 text-base text-fg transition-colors duration-200 placeholder:text-subtle";

function FieldLabel({ name, required, children }: { name: ContactField; required?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={fieldId(name)} className="mb-2 block text-[0.95rem] font-medium text-fg">
      {children}
      {required && (
        <>
          <span className="ml-1 text-accent-soft" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> (จำเป็น)</span>
        </>
      )}
    </label>
  );
}

function FieldError({ name, message }: { name: ContactField; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${fieldId(name)}-error`} className="kc-error mt-2 flex items-start gap-1.5 text-sm">
      <span aria-hidden="true">!</span>
      {message}
    </p>
  );
}

export function ContactForm({
  phoneDisplay,
  phoneHref,
  lineHref,
}: {
  phoneDisplay: string;
  phoneHref: string;
  lineHref?: string;
}) {
  const [values, setValues] = useState<ContactFormValues>(EMPTY_CONTACT);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [summary, setSummary] = useState<ContactField[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Bangkok "today" (client only: avoids SSR/client date mismatches near midnight).
  const today = useSyncExternalStore(noopSubscribe, () => bangkokToday(), () => "");
  const panelRef = useRef<HTMLHeadingElement>(null);
  const summaryId = useId();

  useEffect(() => {
    if (status.kind === "success" || status.kind === "error") panelRef.current?.focus();
  }, [status.kind]);

  const set = <K extends ContactField>(name: K, value: ContactFormValues[K]) => {
    const next = { ...values, [name]: value };
    setValues(next);
    // Live re-check only once the field already shows an error (clears it as the user fixes it).
    if (errors[name]) setErrors((e) => ({ ...e, [name]: validateField(name, next, today || bangkokToday()) }));
  };

  /** Inline validation when leaving a field. */
  const onBlur = (name: ContactField) => {
    setErrors((e) => ({ ...e, [name]: validateField(name, values, today || bangkokToday()) }));
  };

  const focusField = (name: ContactField) => {
    const el =
      name === "preferred_channel"
        ? document.querySelector<HTMLInputElement>(`input[name="preferred_channel"]`)
        : document.getElementById(fieldId(name));
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  };

  const submit = async () => {
    if (status.kind === "submitting") return;
    const payload = { ...values, source_page: SOURCE_PAGE };
    const result = validateContact(payload, today || bangkokToday());
    if (!result.ok) {
      setErrors(result.errors);
      const order = CONTACT_FIELD_ORDER.filter((f) => result.errors[f]);
      setSummary(order);
      if (order[0]) focusField(order[0]);
      return;
    }
    setSummary([]);
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string; fields?: Record<string, string> } }
        | null;
      if (res.status === 201) {
        setStatus({ kind: "success" });
        return;
      }
      if (res.status === 422 && body?.error?.fields) {
        const fields = body.error.fields;
        const next: ContactErrors = {};
        for (const f of CONTACT_FIELD_ORDER) if (fields[f]) next[f] = fields[f];
        setErrors(next);
        const order = CONTACT_FIELD_ORDER.filter((f) => next[f]);
        setStatus({ kind: "idle" });
        if (order.length) {
          setSummary(order);
          focusField(order[0]);
          return;
        }
      }
      if (res.status === 429) {
        setStatus({ kind: "error", rateLimited: true, message: copy.rateLimited(waitText(res.headers.get("retry-after"))) });
        return;
      }
      setStatus({ kind: "error", message: body?.error?.message ?? copy.failure.network });
    } catch {
      setStatus({ kind: "error", message: copy.failure.network });
    }
  };

  const reset = () => {
    setValues(EMPTY_CONTACT);
    setErrors({});
    setSummary([]);
    setStatus({ kind: "idle" });
  };

  const fallback = (
    <p className="text-sm leading-[1.8] text-muted">
      {copy.failure.fallback}{" "}
      <a href={phoneHref} className="font-medium text-accent-soft underline underline-offset-4">
        โทร {phoneDisplay}
      </a>
      {lineHref && (
        <>
          {" "}หรือ{" "}
          <a href={lineHref} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-soft underline underline-offset-4">
            LINE Official
          </a>
        </>
      )}
    </p>
  );

  if (status.kind === "success") {
    return (
      <div className="kc-panel flex flex-col gap-5" role="status">
        <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-accent text-white">
          <svg viewBox="0 0 20 20" className="size-6">
            <path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h3 ref={panelRef} tabIndex={-1} className="thai-heading text-2xl font-semibold outline-none">
          {copy.success.heading}
        </h3>
        <p className="leading-[1.85] text-muted">{copy.success.body}</p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-12 w-fit items-center rounded-full border border-line-strong px-6 font-medium transition-colors hover:border-fg/50"
        >
          {copy.success.again}
        </button>
      </div>
    );
  }

  const submitting = status.kind === "submitting";

  const describedBy = (name: ContactField, hint?: boolean) =>
    [hint ? `${fieldId(name)}-hint` : "", errors[name] ? `${fieldId(name)}-error` : ""].filter(Boolean).join(" ") ||
    undefined;

  const text = (
    name: Exclude<ContactField, "consent" | "preferred_channel">,
    opts: {
      required?: boolean;
      type?: string;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
      autoComplete?: string;
      hint?: string;
      maxLength?: number;
      min?: string;
    } = {},
  ) => (
    <div>
      <FieldLabel name={name} required={opts.required}>
        {copy.labels[name as keyof typeof copy.labels]}
      </FieldLabel>
      <input
        id={fieldId(name)}
        name={name}
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        autoComplete={opts.autoComplete}
        maxLength={opts.maxLength}
        min={opts.min}
        required={opts.required}
        aria-required={opts.required || undefined}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={describedBy(name, Boolean(opts.hint))}
        value={values[name]}
        onChange={(e) => set(name, e.target.value)}
        onBlur={() => onBlur(name)}
        className={inputCls}
      />
      {opts.hint && (
        <p id={`${fieldId(name)}-hint`} className="mt-1.5 text-sm text-subtle">
          {opts.hint}
        </p>
      )}
      <FieldError name={name} message={errors[name]} />
    </div>
  );

  return (
    <form
      noValidate
      aria-busy={submitting}
      aria-describedby={summary.length ? summaryId : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-6"
    >
      <p className="text-sm text-subtle">{copy.requiredNote}</p>

      {summary.length > 0 && (
        <div id={summaryId} role="alert" className="kc-summary rounded-2xl border p-5">
          <p className="font-medium text-fg">
            {copy.errorSummary} ({summary.length} รายการ)
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {summary.map((f) =>
              errors[f] ? (
                <li key={f}>
                  <a
                    href={`#${fieldId(f)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusField(f);
                    }}
                    className="underline underline-offset-4"
                  >
                    {errors[f]}
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {text("first_name", { required: true, autoComplete: "given-name", maxLength: CONTACT_LIMITS.first_name })}
        {text("last_name", { autoComplete: "family-name", maxLength: CONTACT_LIMITS.last_name })}
        {text("company", { autoComplete: "organization", maxLength: CONTACT_LIMITS.company })}
        {text("line_id", { autoComplete: "off", maxLength: CONTACT_LIMITS.line_id })}
        {text("phone", { required: true, type: "tel", inputMode: "tel", autoComplete: "tel", hint: copy.hints.phone, maxLength: 20 })}
        {text("email", { required: true, type: "email", inputMode: "email", autoComplete: "email", maxLength: CONTACT_LIMITS.email })}
      </div>

      <fieldset
        role="radiogroup"
        aria-required="true"
        aria-invalid={errors.preferred_channel ? true : undefined}
        aria-describedby={errors.preferred_channel ? `${fieldId("preferred_channel")}-error` : undefined}
      >
        <legend className="mb-3 text-[0.95rem] font-medium text-fg">
          {copy.labels.preferred_channel}
          <span className="ml-1 text-accent-soft" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> (จำเป็น)</span>
        </legend>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {copy.channels.map((c) => (
            <label key={c.value} className="kc-choice relative flex min-h-12 items-center justify-center rounded-xl border border-line-strong px-3 text-center text-[0.95rem] transition-colors">
              <input
                type="radio"
                name="preferred_channel"
                value={c.value}
                checked={values.preferred_channel === c.value}
                onChange={() => set("preferred_channel", c.value)}
                className="kc-radio absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-xl"
              />
              <span className="pointer-events-none relative">{c.label}</span>
            </label>
          ))}
        </div>
        <FieldError name="preferred_channel" message={errors.preferred_channel} />
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        {text("preferred_date", { type: "date", min: today || undefined })}
        {text("preferred_time", { type: "time" })}
      </div>

      <div>
        <FieldLabel name="message">{copy.labels.message}</FieldLabel>
        <p id={`${fieldId("message")}-hint`} className="-mt-1 mb-2 text-sm text-subtle">
          {copy.hints.message}
        </p>
        <textarea
          id={fieldId("message")}
          name="message"
          rows={5}
          maxLength={CONTACT_LIMITS.message}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={describedBy("message", true)}
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
          onBlur={() => onBlur("message")}
          className={`${inputCls} min-h-[8.5rem] resize-y py-3 leading-[1.7]`}
        />
        <p className="mt-1.5 text-right text-xs text-subtle" aria-hidden="true">
          {values.message.length.toLocaleString("en-US")}/{CONTACT_LIMITS.message.toLocaleString("en-US")}
        </p>
        <FieldError name="message" message={errors.message} />
      </div>

      {/* Honeypot: invisible to people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="kc-hp">
        <label htmlFor="cf-website">เว็บไซต์ (ไม่ต้องกรอก)</label>
        <input
          id="cf-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-start gap-3">
          <input
            id={fieldId("consent")}
            name="consent"
            type="checkbox"
            required
            aria-required="true"
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={[`${fieldId("consent")}-note`, errors.consent ? `${fieldId("consent")}-error` : ""].filter(Boolean).join(" ")}
            checked={values.consent}
            onChange={(e) => set("consent", e.target.checked)}
            className="kc-check mt-1 size-5 shrink-0 cursor-pointer"
          />
          <label htmlFor={fieldId("consent")} className="text-[0.95rem] leading-[1.75] text-fg">
            {copy.consent.before}
            <Link href="/privacy" target="_blank" className="text-accent-soft underline underline-offset-4">
              {copy.consent.link}
              <span className="sr-only"> (เปิดในแท็บใหม่)</span>
            </Link>
            <span className="ml-1 text-accent-soft" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (จำเป็น)</span>
          </label>
        </div>
        <p id={`${fieldId("consent")}-note`} className="mt-2 pl-8 text-sm leading-[1.75] text-subtle">
          {copy.privacyNote}
        </p>
        <FieldError name="consent" message={errors.consent} />
      </div>

      {status.kind === "error" && (
        <div className="kc-panel flex flex-col gap-3 rounded-2xl border border-line-strong p-5" role="alert">
          <h3 ref={panelRef} tabIndex={-1} className="font-semibold text-fg outline-none">
            {copy.failure.heading}
          </h3>
          <p className="text-sm leading-[1.8] text-muted">{status.message}</p>
          {fallback}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={submitting}
          className="relative inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-accent px-8 text-base font-medium text-white transition-[box-shadow,opacity] duration-300 hover:shadow-[0_10px_40px_-6px_var(--accent-glow)] disabled:cursor-progress disabled:opacity-70 sm:text-lg"
        >
          {submitting && (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 animate-spin">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {submitting ? copy.submitting : status.kind === "error" ? copy.failure.retry : copy.submit}
        </button>
      </div>
    </form>
  );
}
