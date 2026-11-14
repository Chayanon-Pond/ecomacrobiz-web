"use client";

/**
 * 30-day daily leads column chart, hand-written SVG.
 * - one series in --adm-chart-1 (validated >= 3:1 on both surfaces), thin
 *   columns (<= 24px), 4px rounded tops, square at the baseline, recessive grid;
 * - hover a column OR focus the chart and use ←/→/Home/End to inspect a day;
 *   the readout is an HTML tooltip and an aria-live line;
 * - <title>/<desc> + a visually-hidden data table for screen readers.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ymdLong, ymdShort } from "@/lib/admin/time";

type Day = { date: string; count: number };

const H = 220;
const PAD = { top: 16, right: 8, bottom: 28, left: 32 };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const n = m * pow;
    if (n >= v) return n;
  }
  return 10 * pow;
}

export function LeadsDailyChart({ daily }: { daily: Day[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [kbd, setKbd] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stats = useMemo(() => {
    const total = daily.reduce((a, d) => a + d.count, 0);
    const peak = daily.reduce<Day | null>((p, d) => (!p || d.count > p.count ? d : p), null);
    return { total, peak, max: niceMax(Math.max(0, ...daily.map((d) => d.count))) };
  }, [daily]);

  const n = daily.length || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(24, slot - 2));
  const y = (v: number) => PAD.top + innerH - (v / stats.max) * innerH;
  const ticks = [0, stats.max / 2, stats.max];
  const labelEvery = width < 420 ? 10 : width < 640 ? 7 : 5;

  const summary =
    stats.total === 0
      ? "ไม่มี Leads ใหม่ใน 30 วันที่ผ่านมา"
      : `รวม ${stats.total.toLocaleString("th-TH")} รายการใน ${n} วัน${
          stats.peak ? ` · สูงสุด ${stats.peak.count.toLocaleString("th-TH")} รายการ เมื่อ ${ymdLong(stats.peak.date)}` : ""
        }`;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!daily.length) return;
    const cur = active ?? daily.length - 1;
    let next = cur;
    if (e.key === "ArrowRight") next = Math.min(daily.length - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = daily.length - 1;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setKbd(true);
    setActive(next);
  }

  const a = active !== null ? daily[active] : null;
  const tipX = active !== null ? PAD.left + slot * active + slot / 2 : 0;

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted">{summary}</p>
      <div
        ref={wrap}
        className="relative rounded-lg"
        tabIndex={0}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKey}
        onFocus={() => {
          if (active === null && daily.length) {
            setKbd(true);
            setActive(daily.length - 1);
          }
        }}
        onBlur={() => {
          if (kbd) setActive(null);
          setKbd(false);
        }}
        onPointerLeave={() => !kbd && setActive(null)}
      >
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block max-w-full" aria-hidden="true">
          <title id={titleId}>Leads ใหม่รายวัน 30 วันล่าสุด</title>
          <desc id={descId}>{summary}. ใช้ปุ่มลูกศรซ้าย/ขวาเพื่อดูค่าแต่ละวัน</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--adm-chart-axis)" : "var(--adm-chart-grid)"}
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--subtle)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {daily.map((d, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            const top = y(d.count);
            const h = PAD.top + innerH - top;
            const r = Math.min(4, h, barW / 2);
            const isA = i === active;
            const isToday = i === daily.length - 1;
            return (
              <g key={d.date} onPointerEnter={() => { setKbd(false); setActive(i); }}>
                {/* hit area: the full slot, taller than the mark */}
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                {d.count > 0 ? (
                  <path
                    d={`M${x},${PAD.top + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD.top + innerH} Z`}
                    fill={isA ? "var(--adm-chart-1-hover)" : "var(--adm-chart-1)"}
                    opacity={active === null || isA ? 1 : 0.55}
                  />
                ) : null}
                {(i % labelEvery === (daily.length - 1) % labelEvery) || isToday ? (
                  <text
                    x={PAD.left + slot * i + slot / 2}
                    y={H - 8}
                    textAnchor={isToday ? "end" : "middle"}
                    fontSize="11"
                    fill={isToday ? "var(--muted)" : "var(--subtle)"}
                  >
                    {isToday ? "วันนี้" : ymdShort(d.date)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {active !== null ? (
            <rect
              x={PAD.left + slot * active + (slot - barW) / 2 - 2}
              y={PAD.top - 2}
              width={barW + 4}
              height={innerH + 4}
              rx={5}
              fill="none"
              stroke={kbd ? "var(--adm-focus)" : "none"}
              strokeWidth={1.5}
            />
          ) : null}
        </svg>
        {a ? (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(tipX, 70), width - 70) }}
            aria-hidden="true"
          >
            <span className="block font-display text-base font-semibold tabular-nums">{a.count.toLocaleString("th-TH")}</span>
            <span className="text-muted">Leads · {ymdLong(a.date)}</span>
          </div>
        ) : null}
        <p className="adm-sr-only" aria-live="polite">
          {a && kbd ? `${ymdLong(a.date)}: ${a.count} รายการ` : ""}
        </p>
      </div>
      <details className="text-xs text-muted">
        <summary className="w-fit">ดูข้อมูลเป็นตาราง</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-line">
          <table className="adm-table">
            <caption className="adm-sr-only">Leads ใหม่รายวัน 30 วันล่าสุด</caption>
            <thead>
              <tr>
                <th scope="col">วันที่</th>
                <th scope="col" className="adm-num">
                  Leads ใหม่
                </th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{ymdLong(d.date)}</td>
                  <td className="adm-num">{d.count.toLocaleString("th-TH")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
