"use client";

/** /admin/leads/[id] — full-page view of the same panel used in the leads drawer. */
import { ArrowLeft } from "lucide-react";
import { useParams } from "next/navigation";
import { LeadPanel } from "./leads/LeadPanel";
import { useAdmin } from "./SessionProvider";
import { ButtonLink } from "./ui/Button";
import { NoAccess } from "./ui/EmptyState";

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAdmin();
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <ButtonLink href="/admin/leads" variant="ghost" size="sm" icon={<ArrowLeft size={15} aria-hidden="true" />}>
          กลับไปรายชื่อผู้ติดต่อ
        </ButtonLink>
      </div>
      {can("leads:read") ? (
        <div className="adm-card p-5 sm:p-6">
          <LeadPanel id={id} headingLevel="h1" />
        </div>
      ) : (
        <NoAccess />
      )}
    </div>
  );
}
