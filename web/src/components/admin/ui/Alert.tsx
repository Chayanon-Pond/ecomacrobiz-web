import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

const ICONS = { danger: XCircle, info: Info, warning: AlertTriangle, success: CheckCircle2 };

/** Inline message box. tone=danger uses role=alert; others are plain text. */
export function Alert({
  tone = "danger",
  title,
  children,
  action,
  className,
}: {
  tone?: "danger" | "info" | "warning" | "success";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={cx("adm-alert", className)} data-tone={tone === "danger" ? undefined : tone} role={tone === "danger" ? "alert" : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div className="adm-alert-body">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5 text-muted" : undefined}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
