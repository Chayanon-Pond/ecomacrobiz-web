import Link from "next/link";

function pageHref(base: string, page: number) {
  return page <= 1 ? base : `${base}?page=${page}`;
}

/** ?page= pagination (rendered only when there is more than one page). */
export function Pagination({ base, page, totalPages }: { base: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const cls =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong px-4 font-display text-sm transition-colors duration-300 hover:border-fg/50";
  return (
    <nav aria-label="การแบ่งหน้า" className="mt-14 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link href={pageHref(base, page - 1)} rel="prev" className={cls}>
          ก่อนหน้า
        </Link>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} aria-current="page" className={`${cls} border-accent bg-accent text-white`}>
            <span className="sr-only">หน้า </span>
            {p}
          </span>
        ) : (
          <Link key={p} href={pageHref(base, p)} className={cls}>
            <span className="sr-only">หน้า </span>
            {p}
          </Link>
        ),
      )}
      {page < totalPages && (
        <Link href={pageHref(base, page + 1)} rel="next" className={cls}>
          ถัดไป
        </Link>
      )}
    </nav>
  );
}
