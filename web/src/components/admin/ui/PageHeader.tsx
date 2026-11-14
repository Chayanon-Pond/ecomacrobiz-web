import type { ReactNode } from "react";

/** Page title row. One h1 per admin page. (`subtitle` kept for older callers.) */
export function PageHeader({
  title,
  description,
  subtitle,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const desc = description ?? subtitle;
  return (
    <div className="adm-page-head">
      <div className="min-w-0">
        <h1 className="adm-page-title thai-heading">{title}</h1>
        {desc ? <p className="adm-page-desc">{desc}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
