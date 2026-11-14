"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AlertTriangle, GripVertical, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { formatImageTitle, parseImageTitle, useUploadProgress } from "./utils";

/**
 * Block image: preview + inline alt text and caption. The caption lives in the
 * Markdown title next to the dimensions (`"1200x800 Caption"`), so editing it
 * needs the size; images without a stored size use the loaded natural size.
 */
export function ImageView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const title = (node.attrs.title as string | null) ?? null;
  const uploadId = (node.attrs.uploadId as string | null) ?? null;
  const progress = useUploadProgress(uploadId);
  const meta = parseImageTitle(title);
  const img = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const editable = editor.isEditable && !uploadId;
  const width = meta?.width ?? natural?.w ?? 0;
  const height = meta?.height ?? natural?.h ?? 0;

  return (
    <NodeViewWrapper className="ed-figure" data-selected={selected || undefined} data-uploading={uploadId ? "" : undefined}>
      <div className="ed-figure-media" contentEditable={false}>
        {editor.isEditable ? (
          <span className="ed-figure-grip" data-drag-handle title="ลากเพื่อย้ายรูป" aria-hidden="true">
            <GripVertical size={16} />
          </span>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={img}
          src={src}
          alt={alt}
          width={width || undefined}
          height={height || undefined}
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {uploadId ? (
          <div className="ed-figure-progress" role="status">
            <span>กำลังอัปโหลด… {Math.round((progress ?? 0) * 100)}%</span>
            <span className="ed-bar">
              <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </span>
          </div>
        ) : null}
        {editable && selected ? (
          <button type="button" className="ed-figure-del" onClick={() => deleteNode()} aria-label="ลบรูปนี้">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {editable ? (
        <div className="ed-figure-fields" contentEditable={false}>
          <input
            className="ed-caption-input"
            aria-label="คำบรรยายใต้ภาพ"
            placeholder={width && height ? "เพิ่มคำบรรยายใต้ภาพ (ไม่บังคับ)" : "กำลังอ่านขนาดรูป…"}
            disabled={!(width && height)}
            value={meta?.caption ?? ""}
            onChange={(e) => updateAttributes({ title: formatImageTitle(width, height, e.target.value) })}
          />
          <label className="ed-alt" data-missing={!alt.trim() || undefined}>
            <span className="ed-alt-tag">ALT</span>
            <input
              aria-label="คำอธิบายรูป (alt text)"
              placeholder="อธิบายภาพนี้เป็นภาษาไทย (สำหรับผู้พิการทางสายตาและ SEO)"
              value={alt}
              maxLength={300}
              onChange={(e) => updateAttributes({ alt: e.target.value.replace(/[\r\n]+/g, " ") })}
            />
            {!alt.trim() ? <AlertTriangle size={14} aria-hidden="true" className="shrink-0" /> : null}
          </label>
        </div>
      ) : meta?.caption ? (
        <span className="prose-caption">{meta.caption}</span>
      ) : null}
    </NodeViewWrapper>
  );
}
