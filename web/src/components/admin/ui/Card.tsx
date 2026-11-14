import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export function Card({
  className,
  children,
  as: Tag = "div",
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "aside" }) {
  return (
    <Tag className={cx("adm-card", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  titleId,
  as: H = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className="adm-card-header">
      <div className="min-w-0">
        <H id={titleId} className="adm-card-title">
          {title}
        </H>
        {description ? <p className="adm-card-desc">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("adm-card-body", className)}>{children}</div>;
}

/** Whole-card link (keeps hover affordance, one tab stop). */
export function CardLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx("adm-card adm-card-link", className)}>
      {children}
    </Link>
  );
}
