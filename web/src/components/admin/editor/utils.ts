import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";

/* ---------------- links ---------------- */

/**
 * Validates/normalizes what the user typed in the link dialog.
 * Allowed: https/http URLs with a real host, mailto:, tel:, site-relative
 * paths (/knowledge/…) and #anchors. Bare domains get https:// prepended.
 */
export function normalizeLink(raw: string): { url: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: "กรุณากรอก URL" };
  if (/\s/.test(v)) return { error: "URL ต้องไม่มีช่องว่าง" };
  if ((v.startsWith("/") && !v.startsWith("//")) || v.startsWith("#")) return { url: v };
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(v)) return { url: v };
  if (/^tel:\+?[0-9()\-\s.]{3,}$/i.test(v)) return { url: v };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(v) ? `https://${v}` : null;
  if (!withScheme) return { error: "รูปแบบลิงก์ไม่ถูกต้อง เช่น https://example.com, /knowledge/… หรือ mailto:" };
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { error: "รูปแบบลิงก์ไม่ถูกต้อง" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { error: "รองรับเฉพาะลิงก์ https://, http://, mailto:, tel: หรือลิงก์ภายในเว็บไซต์ที่ขึ้นต้นด้วย /" };
  }
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return { error: "ชื่อโดเมนไม่ถูกต้อง" };
  return { url: withScheme };
}

/* ---------------- image title convention ---------------- */

const DIM_RE = /^(\d{2,5})x(\d{2,5})(?:\s+([\s\S]+))?$/;

/** `"1200x800 Caption"` (Markdown.tsx convention) -> parts. */
export function parseImageTitle(title: string | null | undefined): { width: number; height: number; caption: string } | null {
  const m = title ? DIM_RE.exec(title.trim()) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]), caption: (m[3] ?? "").trim() } : null;
}

export function formatImageTitle(width: number, height: number, caption: string): string | null {
  if (!(width > 0 && height > 0)) return null;
  const c = caption.replace(/[\r\n]+/g, " ").trim();
  return `${Math.round(width)}x${Math.round(height)}${c ? ` ${c}` : ""}`;
}

/* ---------------- upload progress store ---------------- */

const progress = new Map<string, number>();
const listeners = new Set<() => void>();

export const uploadProgress = {
  set(id: string, value: number) {
    progress.set(id, value);
    listeners.forEach((l) => l());
  },
  clear(id: string) {
    progress.delete(id);
    listeners.forEach((l) => l());
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUploadProgress(id: string | null): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (progress.get(id) ?? 0) : null),
    () => null,
  );
}

/* ---------------- document helpers ---------------- */

/** Position of the image node carrying this uploadId, or -1. */
export function findUpload(editor: Editor, uploadId: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "image" && node.attrs.uploadId === uploadId) found = pos;
    return true;
  });
  return found;
}

/** GFM alignment is per column: apply it to every cell of the current column. */
export function setColumnAlign(editor: Editor, align: "left" | "center" | "right" | null): boolean {
  const { $from } = editor.state.selection;
  let cellDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d).type.name;
    if (n === "tableCell" || n === "tableHeader") {
      cellDepth = d;
      break;
    }
  }
  if (cellDepth < 2) return false;
  const col = $from.index(cellDepth - 1);
  const table = $from.node(cellDepth - 2);
  const tableStart = $from.start(cellDepth - 2);
  const tr = editor.state.tr;
  let rowPos = tableStart;
  table.forEach((row) => {
    let cellPos = rowPos + 1;
    row.forEach((cell, _offset, i) => {
      if (i === col) tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, align });
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  editor.view.dispatch(tr);
  return true;
}

/* ---------------- text stats ---------------- */

/** Word count that works for Thai (no spaces between words). */
export function countWords(text: string): number {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Seg) return text.split(/\s+/).filter(Boolean).length;
  let n = 0;
  for (const s of new Seg("th", { granularity: "word" }).segment(text)) if (s.isWordLike) n++;
  return n;
}

export function countChars(text: string): number {
  return [...text.replace(/\s+/g, "")].length;
}

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
