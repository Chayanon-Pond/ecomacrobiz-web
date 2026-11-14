import { office } from "@/content/site";

/**
 * Office NAP + opening hours (content/site.ts `office`). Server component,
 * shared by the footer and /contact so the text is identical everywhere.
 */
export function OfficeAddress({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-4 text-sm leading-[1.8] ${className}`}>
      <address className="flex flex-col gap-1 not-italic">
        <span className="font-display font-semibold tracking-[0.04em] text-fg">{office.name}</span>
        <span className="text-muted">{office.addressTh}</span>
        <span lang="en" className="text-subtle">
          {office.addressEn}
        </span>
        <a
          href={office.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 text-accent-soft underline-offset-4 hover:underline"
        >
          เปิดใน Google Maps
          <span className="sr-only"> (เปิดหน้าต่างใหม่)</span>
          <span aria-hidden="true">↗</span>
        </a>
      </address>
      <p className="flex flex-col">
        <span className="text-fg">
          <span className="sr-only">เวลาทำการ: </span>
          {office.hours.labelTh}
        </span>
        <span lang="en" className="text-subtle">
          {office.hours.labelEn}
        </span>
      </p>
    </div>
  );
}
