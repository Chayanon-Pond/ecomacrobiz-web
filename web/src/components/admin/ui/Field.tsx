"use client";

import { AlertCircle } from "lucide-react";
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

/** Props a Field hands to its control (spread them onto Input / Select / Textarea). */
export type FieldControlProps = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  "aria-required"?: true;
};

/**
 * Label + control + error + hint, wired for a11y:
 *   <Field label="อีเมล" required error={errors.email} hint="…">
 *     {(p) => <Input {...p} value={v} onChange={…} />}
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  id: idProp,
  className,
  labelHidden,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  id?: string;
  className?: string;
  labelHidden?: boolean;
  children: (p: FieldControlProps) => ReactNode;
}) {
  const auto = useId();
  const id = idProp ?? `f${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("adm-field", className)}>
      <label htmlFor={id} className={labelHidden ? "adm-sr-only" : "adm-label"}>
        {label}
        {required ? (
          <span className="adm-req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required ? true : undefined,
      })}
      {error ? (
        <p id={errId} className="adm-field-error">
          <AlertCircle size={14} aria-hidden="true" className="mt-[0.2rem] shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="adm-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Sz = { inputSize?: "sm" | "md" };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Sz & { icon?: ReactNode }>(
  function Input({ className, inputSize, icon, ...rest }, ref) {
    const input = (
      <input ref={ref} className={cx("adm-input", inputSize === "sm" && "adm-input-sm", className)} {...rest} />
    );
    if (!icon) return input;
    return (
      <span className="adm-input-wrap block">
        {icon}
        {input}
      </span>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={cx("adm-input", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Sz>(function Select(
  { className, inputSize, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx("adm-input", inputSize === "sm" && "adm-input-sm", className)} {...rest}>
      {children}
    </select>
  );
});
