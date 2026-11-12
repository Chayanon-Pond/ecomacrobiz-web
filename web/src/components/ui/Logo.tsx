import Link from "next/link";
import { site } from "@/content/site";

/** The ecomacrobiz block mark, traced from the client's logo file. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 674 338"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="var(--brand-mark)">
        <rect x="138" y="0" width="336" height="175" />
        <rect x="0" y="174" width="168" height="164" />
        <rect x="306" y="174" width="368" height="164" />
      </g>
    </svg>
  );
}

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onClick}
      aria-label={`${site.name} — หน้าแรก`}
      className="group inline-flex min-h-11 items-center gap-2.5"
    >
      <LogoMark className="h-[14px] w-auto transition-transform duration-500 ease-out-expo group-hover:-translate-y-0.5" />
      <span className="font-display text-[1.05rem] font-bold tracking-[-0.03em] text-fg">
        {site.wordmark}
      </span>
    </Link>
  );
}
