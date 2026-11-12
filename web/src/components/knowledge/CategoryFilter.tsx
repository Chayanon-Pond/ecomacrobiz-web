import Link from "next/link";
import type { Category } from "@/lib/posts";
import { categoryHref } from "./format";

/**
 * Category navigation. Real links (crawlable, work without JS); the current
 * one carries aria-current="page". Empty categories are hidden here but keep
 * their own page. Chips wrap (a horizontal scroller widened the mobile
 * layout viewport in Chrome).
 */
export function CategoryFilter({
  categories,
  active,
  total,
}: {
  categories: Category[];
  active: string | null;
  total: number;
}) {
  const items = [
    { href: "/knowledge", label: "ทั้งหมด", sub: "All", count: total, current: active === null },
    ...categories
      .filter((c) => c.postCount > 0 || c.slug === active)
      .map((c) => ({
        href: categoryHref(c.slug),
        label: c.nameTh,
        sub: c.name,
        count: c.postCount,
        current: c.slug === active,
      })),
  ];
  return (
    <nav aria-label="หมวดหมู่บทความ" className="kn-filter">
      <ul className="flex flex-wrap gap-2 py-1">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={it.current ? "page" : undefined}
              className="kn-chip inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors duration-300"
            >
              <span className="font-medium">{it.label}</span>
              <span className="hidden font-display text-[0.7rem] tracking-[0.12em] opacity-70 sm:inline">{it.sub.toUpperCase()}</span>
              <span className="kn-chip-count rounded-full px-2 py-0.5 font-display text-xs tabular-nums">
                {it.count}
                <span className="sr-only"> บทความ</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
