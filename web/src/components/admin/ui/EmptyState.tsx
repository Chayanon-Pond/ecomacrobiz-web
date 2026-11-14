import { AlertTriangle, Inbox, Lock, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "danger";
  className?: string;
}) {
  return (
    <div className={cx("adm-empty", className)} data-tone={tone}>
      <span className="adm-empty-icon" aria-hidden="true">
        {icon ?? <Inbox size={22} />}
      </span>
      <p className="adm-empty-title">{title}</p>
      {description ? <p className="adm-empty-desc">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Load failure with a retry button (role=alert). */
export function ErrorState({
  message,
  onRetry,
  title = "โหลดข้อมูลไม่สำเร็จ",
  className,
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={className}>
      <EmptyState
        tone="danger"
        icon={<AlertTriangle size={22} />}
        title={title}
        description={message}
        action={
          onRetry ? (
            <Button icon={<RotateCw size={15} aria-hidden="true" />} onClick={onRetry}>
              ลองใหม่
            </Button>
          ) : null
        }
      />
    </div>
  );
}

/** UI-only permission gate message (the API enforces the real check). */
export function NoAccess({ description }: { description?: ReactNode }) {
  return (
    <div className="adm-card">
      <EmptyState
        icon={<Lock size={22} />}
        title="ไม่มีสิทธิ์เข้าถึง"
        description={description ?? "บทบาทของคุณไม่สามารถดูหน้านี้ได้ หากต้องการสิทธิ์เพิ่ม กรุณาติดต่อเจ้าของระบบ (Owner)"}
      />
    </div>
  );
}
