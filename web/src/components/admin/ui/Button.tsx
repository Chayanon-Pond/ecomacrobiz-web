"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", block?: boolean) {
  return cx(
    "adm-btn",
    variant === "primary" && "adm-btn-primary",
    variant === "ghost" && "adm-btn-ghost",
    variant === "danger" && "adm-btn-danger",
    variant === "danger-solid" && "adm-btn-danger-solid",
    size === "sm" && "adm-btn-sm",
    size === "lg" && "adm-btn-lg",
    block && "adm-btn-block",
  );
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Leading icon, e.g. <Plus size={16} aria-hidden />. */
  icon?: ReactNode;
  iconRight?: ReactNode;
};

export function Button({
  variant,
  size,
  block,
  icon,
  iconRight,
  loading,
  loadingText,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Shows a spinner, disables the button and sets aria-busy. */
    loading?: boolean;
    loadingText?: ReactNode;
  }) {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, size, block), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {loading && loadingText ? loadingText : children}
      {!loading && iconRight}
    </button>
  );
}

/** next/link styled as a button. `external` opens a new tab with a plain <a>. */
export function ButtonLink({
  href,
  variant,
  size,
  block,
  icon,
  iconRight,
  className,
  children,
  external,
  ...rest
}: Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; external?: boolean }) {
  const cls = cx(buttonClass(variant, size, block), className);
  if (external) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener" {...rest}>
        {icon}
        {children}
        {iconRight}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}

/**
 * Square icon-only button. `label` is required: it becomes the aria-label and
 * a visual tooltip (aria-hidden, so it is not announced twice).
 */
export function IconButton({
  label,
  children,
  variant,
  size,
  tooltip = true,
  tooltipSide,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom" | "right";
}) {
  const btn = (
    <button
      type={type}
      aria-label={label}
      className={cx("adm-icon-btn", className)}
      data-variant={variant === "ghost" ? undefined : variant}
      data-size={size === "sm" ? "sm" : undefined}
      {...rest}
    >
      {children}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip content={label} side={tooltipSide} decorative>
      {btn}
    </Tooltip>
  );
}
