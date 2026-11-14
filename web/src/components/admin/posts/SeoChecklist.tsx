"use client";

/**
 * Live SEO score + checklist for the post editor side panel. Advisory only:
 * never blocks saving or publishing. Lazy chunk (parses Markdown with remark).
 */
import { Check, CircleAlert, CircleX, Copy, ExternalLink, Link2, Plus } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { LinkSuggestion } from "@/lib/admin/types";
import { errorMessage, useAdmin } from "../SessionProvider";
import { Button, copyText, Field, Input, Skeleton, useToast } from "../ui";
import { LIMITS } from "./post-form";
import {
  analyzeSeo,
  extractFacts,
  GROUP_LABEL,
  pathOf,
  type CheckGroup,
  type CheckStatus,
  type SeoCheck,
  type SeoInput,
} from "./seo-analysis";
import { SCORE_LABEL, scoreTone } from "./seo-score";

const GROUPS: CheckGroup[] = ["keyword", "meta", "content", "links", "media"];

const STATUS_LABEL: Record<CheckStatus, string> = { pass: "ผ่าน", warn: "ควรปรับ", fail: "ยังไม่ผ่าน" };

export default function SeoChecklist({
  input,
  body,
  postId,
  disabled,
  keywordError,
  onKeywordChange,
  onInsertLink,
  onScore,
}: {
  input: SeoInput;
  body: string;
  postId: string | null;
  disabled?: boolean;
  keywordError?: string;
  onKeywordChange: (v: string) => void;
  /** Inserts a link at the editor cursor; undefined when the editor is not available. */
  onInsertLink?: (href: string, text: string) => void;
  onScore?: (score: number) => void;
}) {
  const deferredBody = useDeferredValue(body);
  const deferredInput = useDeferredValue(input);
  const facts = useMemo(() => extractFacts(deferredBody), [deferredBody]);
  const report = useMemo(() => analyzeSeo(deferredInput, facts), [deferredInput, facts]);
  const tone = scoreTone(report.score);

  useEffect(() => {
    onScore?.(report.score);
  }, [report.score, onScore]);

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of report.checks) counts[c.status]++;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="seo-score" data-tone={tone}>
        <ScoreRing score={report.score} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            คะแนน SEO {SCORE_LABEL[tone]}
          </p>
          <p className="text-xs text-muted">
            ผ่าน {counts.pass} · ควรปรับ {counts.warn} · ยังไม่ผ่าน {counts.fail}
          </p>
          <p className="mt-1 text-xs text-subtle">เป็นคำแนะนำเท่านั้น — เผยแพร่ได้เสมอ</p>
        </div>
      </div>

      <Field
        label="คีย์เวิร์ดหลัก (Focus keyword)"
        error={keywordError}
        hint="คำหรือวลีที่อยากให้ค้นเจอใน Google เช่น “แบรนด์ดิ้ง” · ใช้ตรวจคะแนนเท่านั้น ไม่แสดงบนเว็บไซต์"
      >
        {(p) => (
          <Input
            {...p}
            value={input.focusKeyword}
            maxLength={LIMITS.focusKeyword}
            disabled={disabled}
            placeholder="เช่น การสร้างแบรนด์"
            onChange={(e) => onKeywordChange(e.target.value)}
          />
        )}
      </Field>

      {GROUPS.map((g) => {
        const items = report.checks.filter((c) => c.group === g);
        if (!items.length) return null;
        const passed = items.filter((c) => c.status === "pass").length;
        return (
          <section key={g} className="seo-group" aria-label={GROUP_LABEL[g]}>
            <h3 className="seo-group-head">
              <span>{GROUP_LABEL[g]}</span>
              <span className="seo-group-count" data-done={passed === items.length || undefined}>
                {passed}/{items.length}
              </span>
            </h3>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
              {items.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
            {g === "links" ? (
              <LinksExtra
                postId={postId}
                keyword={input.focusKeyword}
                title={input.title}
                linked={new Set(facts.internal.map((l) => pathOf(l.href)))}
                external={facts.external}
                disabled={disabled}
                onInsertLink={onInsertLink}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="seo-ring" role="img" aria-label={`คะแนน SEO ${score} จาก 100`}>
      <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} className="seo-ring-track" />
        <circle
          cx="28"
          cy="28"
          r={r}
          className="seo-ring-value"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <span aria-hidden="true">{score}</span>
    </div>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  const Icon = check.status === "pass" ? Check : check.status === "warn" ? CircleAlert : CircleX;
  return (
    <li className="seo-check" data-status={check.status}>
      <Icon size={15} aria-hidden="true" className="seo-check-icon" />
      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-snug">
          <span className="adm-sr-only">{STATUS_LABEL[check.status]}: </span>
          {check.label}
        </p>
        {check.detail ? <p className="seo-check-detail">{check.detail}</p> : null}
        {check.status !== "pass" && check.hint ? <p className="seo-check-hint">{check.hint}</p> : null}
      </div>
    </li>
  );
}

type SuggestState = { key: string; rows: LinkSuggestion[] } | { key: string; error: string };

function LinksExtra({
  postId,
  keyword,
  title,
  linked,
  external,
  disabled,
  onInsertLink,
}: {
  postId: string | null;
  keyword: string;
  title: string;
  linked: Set<string>;
  external: { href: string; text: string }[];
  disabled?: boolean;
  onInsertLink?: (href: string, text: string) => void;
}) {
  const { request } = useAdmin();
  const toast = useToast();
  const q = (keyword.trim() || title.trim()).slice(0, 100);
  const key = `${postId ?? ""}|${q}`;
  const [state, setState] = useState<SuggestState | null>(null);

  useEffect(() => {
    if (!postId && !q) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      request<{ data: LinkSuggestion[] }>("posts/link-suggestions", {
        query: { post_id: postId ?? undefined, q },
        signal: ctrl.signal,
      })
        .then((r) => setState({ key, rows: (r.data ?? []).filter((s) => s.id !== postId) }))
        .catch((err) => {
          const m = errorMessage(err);
          if (m) setState({ key, error: m });
        });
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [request, postId, q, key]);

  const current = state?.key === key ? state : null;

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <p className="adm-label">บทความที่แนะนำให้ลิงก์ถึง</p>
        {!postId && !q ? (
          <p className="adm-hint">ใส่ชื่อเรื่องหรือคีย์เวิร์ดเพื่อดูคำแนะนำ</p>
        ) : !current ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
          </div>
        ) : "error" in current ? (
          <p className="adm-hint">โหลดคำแนะนำไม่ได้ ({current.error})</p>
        ) : current.rows.length === 0 ? (
          <p className="adm-hint">ยังไม่พบบทความที่เกี่ยวข้อง — ลองเลือกหมวดหมู่หรือเปลี่ยนคีย์เวิร์ด</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {current.rows.map((s) => {
              const done = linked.has(pathOf(s.url));
              return (
                <li key={s.id} className="seo-suggest">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem]" title={s.title}>
                      {s.title}
                    </p>
                    <p className="truncate font-mono text-[0.6875rem] text-subtle">{s.url}</p>
                  </div>
                  {done ? (
                    <span className="seo-suggest-done">
                      <Check size={13} aria-hidden="true" /> ลิงก์แล้ว
                    </span>
                  ) : (
                    <>
                      {onInsertLink && !disabled ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Plus size={13} aria-hidden="true" />}
                          aria-label={`แทรกลิงก์ไปยัง “${s.title}” ที่ตำแหน่งเคอร์เซอร์`}
                          title="แทรกลิงก์ที่ตำแหน่งเคอร์เซอร์ในเนื้อหา (ถ้าเลือกข้อความไว้ จะทำข้อความนั้นเป็นลิงก์)"
                          onClick={() => {
                            onInsertLink(s.url, s.title);
                            toast.success("แทรกลิงก์แล้ว");
                          }}
                        >
                          แทรก
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        className="adm-icon-btn"
                        data-size="sm"
                        aria-label={`คัดลอกลิงก์ ${s.url}`}
                        title="คัดลอกลิงก์ Markdown"
                        onClick={async () => {
                          const ok = await copyText(`[${s.title}](${s.url})`);
                          if (ok) toast.success("คัดลอกลิงก์แล้ว");
                          else toast.error("คัดลอกไม่ได้");
                        }}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <p className="adm-label">ลิงก์ภายนอกในบทความ ({external.length})</p>
        {external.length ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {external.map((l, i) => (
              <li key={`${l.href}-${i}`} className="seo-ext">
                <ExternalLink size={13} aria-hidden="true" className="shrink-0 text-subtle" />
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate" title={l.href}>
                  {l.text || l.href}
                  {l.text && l.text !== l.href ? <span className="block truncate font-mono text-[0.6875rem] text-subtle">{l.href}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="adm-hint">
          <Link2 size={12} aria-hidden="true" className="mr-1 inline align-[-2px]" />
          เว็บไซต์เปิดลิงก์ภายนอกในแท็บใหม่และใส่ rel=&quot;noopener noreferrer&quot; ให้อัตโนมัติ — ลิงก์ภายในเปิดในแท็บเดิม
        </p>
      </div>
    </div>
  );
}
