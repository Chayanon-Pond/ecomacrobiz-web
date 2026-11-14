"use client";

/**
 * Notion-like block editor (Tiptap v3) whose storage format is Markdown.
 * Loaded only through next/dynamic from the post editor page, so Tiptap,
 * ProseMirror and remark-stringify never reach other routes.
 */
import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Code2,
  Columns3,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Images,
  Italic,
  Keyboard,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Media } from "@/lib/admin/types";
import { MediaPickerDialog } from "../media/MediaPickerDialog";
import { IMAGE_ACCEPT, rejectReason, useMediaUpload } from "../media/upload";
import { alreadyNotified, errorMessage } from "../SessionProvider";
import { useToast } from "../ui";
import type { BlockAction } from "./blocks";
import { LinkDialog, ShortcutsDialog } from "./dialogs";
import { baseExtensions, ImageBlock } from "./extensions";
import { ImageView } from "./ImageView";
import { docToMarkdown, markdownToDoc } from "./markdown";
import { SlashMenu } from "./SlashMenu";
import { countChars, countWords, findUpload, formatImageTitle, isMac, setColumnAlign, uploadProgress } from "./utils";
import "@/components/content/prose.css";
import "./editor.css";

export type BlockEditorApi = {
  /** Serializes pending edits now and returns the Markdown. */
  flush: () => string;
  focus: () => void;
  /** Inserts a link at the last cursor position (or links the selected text). */
  insertLink: (href: string, text: string) => void;
};

export type BlockEditorProps = {
  id: string;
  /** Read once on mount; remount (key) to load other content. */
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  editable?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onReady?: (api: BlockEditorApi) => void;
};

const EMIT_DELAY = 200;
let uploadSeq = 0;

export default function BlockEditor({
  id,
  initialMarkdown,
  onChange,
  editable = true,
  invalid,
  describedBy,
  onReady,
}: BlockEditorProps) {
  const toast = useToast();
  const upload = useMediaUpload();
  const slashKey = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitted = useRef<string | null>(null);
  const changeRef = useRef(onChange);
  const filesRef = useRef<(files: File[], pos?: number) => void>(() => {});
  const fileInput = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable,
    extensions: [
      ...baseExtensions().filter((e) => e.name !== "image"),
      ImageBlock.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
      Placeholder.configure({
        showOnlyCurrent: true,
        includeChildren: false,
        placeholder: ({ node, editor: ed }) => {
          if (node.type.name === "heading") return `หัวข้อ H${node.attrs.level}`;
          return ed.isEmpty ? "เริ่มเขียนเนื้อหา… พิมพ์ / เพื่อแทรกหัวข้อ รูปภาพ ตาราง และอื่น ๆ" : "พิมพ์ / เพื่อเลือกบล็อก";
        },
      }),
    ],
    content: markdownToDoc(initialMarkdown),
    editorProps: {
      attributes: {
        id,
        class: "prose-article ed-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "เนื้อหาบทความ",
      },
      handleKeyDown: (_view, event) => {
        if (slashKey.current?.(event)) {
          event.preventDefault();
          return true;
        }
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setLinkOpen(true);
          return true;
        }
        if (mod && event.key === "/") {
          event.preventDefault();
          setKeysOpen(true);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        filesRef.current(files, view.state.selection.to);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        filesRef.current(files, at?.pos);
        return true;
      },
    },
    onCreate: ({ editor: ed }) => {
      const text = ed.getText({ blockSeparator: " " });
      setStats({ words: countWords(text), chars: countChars(text) });
    },
    onUpdate: ({ editor: ed }) => {
      if (emitTimer.current) clearTimeout(emitTimer.current);
      emitTimer.current = setTimeout(() => emit(ed), EMIT_DELAY);
    },
  });

  // Serialization of the untouched document. Edits that come back to it (and
  // Tiptap's own normalizing transactions, e.g. the trailing paragraph) report
  // the ORIGINAL Markdown, so merely opening a post never rewrites its body.
  const [baseline] = useState(() => docToMarkdown(markdownToDoc(initialMarkdown)));

  function emit(ed: Editor): string {
    emitTimer.current = null;
    const out = docToMarkdown(ed.getJSON());
    const md = out === baseline ? initialMarkdown : out;
    if (md !== lastEmitted.current) {
      lastEmitted.current = md;
      changeRef.current(md);
    }
    const text = ed.getText({ blockSeparator: " " });
    setStats({ words: countWords(text), chars: countChars(text) });
    return md;
  }

  // API for the page (flush before save, focus on error).
  useEffect(() => {
    if (!editor) return;
    onReady?.({
      flush: () => {
        if (emitTimer.current) {
          clearTimeout(emitTimer.current);
          return emit(editor);
        }
        return lastEmitted.current ?? initialMarkdown;
      },
      focus: () => editor.commands.focus(),
      insertLink: (href, text) => {
        const chain = editor.chain().focus();
        if (editor.state.selection.empty) {
          chain.insertContent([{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }, { type: "text", text: " " }]).run();
        } else {
          chain.setLink({ href }).run();
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Validation state lives on the contenteditable itself for screen readers.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    if (invalid) dom.setAttribute("aria-invalid", "true");
    else dom.removeAttribute("aria-invalid");
    if (describedBy) dom.setAttribute("aria-describedby", describedBy);
    else dom.removeAttribute("aria-describedby");
  }, [editor, invalid, describedBy]);

  // Flush a pending emit when the editor goes away (only on editor change/unmount).
  useEffect(
    () => () => {
      if (emitTimer.current && editor) {
        clearTimeout(emitTimer.current);
        emit(editor);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

  /* ---------------- images ---------------- */

  const insertMedia = useCallback(
    (m: Media, pos?: number) => {
      if (!editor) return;
      const attrs = { src: m.url, alt: m.alt ?? "", title: formatImageTitle(m.width, m.height, "") };
      const chain = editor.chain().focus();
      (pos !== undefined ? chain.insertContentAt(pos, { type: "image", attrs }) : chain.insertContent({ type: "image", attrs })).run();
    },
    [editor],
  );

  const uploadFiles = useCallback(
    async (files: File[], pos?: number) => {
      if (!editor) return;
      let at = pos;
      for (const file of files) {
        const reason = rejectReason(file);
        if (reason) {
          toast.error(`${file.name}: ${reason}`);
          continue;
        }
        const uploadId = `up-${++uploadSeq}`;
        const preview = URL.createObjectURL(file);
        uploadProgress.set(uploadId, 0);
        const node = { type: "image", attrs: { src: preview, alt: "", title: null, uploadId } };
        const chain = editor.chain().focus();
        (at !== undefined ? chain.insertContentAt(at, node) : chain.insertContent(node)).run();
        at = undefined;
        try {
          const m = await upload(file, { onProgress: (f) => uploadProgress.set(uploadId, f) });
          const p = findUpload(editor, uploadId);
          if (p >= 0) {
            const current = editor.state.doc.nodeAt(p);
            const tr = editor.state.tr.setNodeMarkup(p, undefined, {
              ...current?.attrs,
              src: m.url,
              alt: (current?.attrs.alt as string) || m.alt || "",
              title: formatImageTitle(m.width, m.height, ""),
              uploadId: null,
            });
            editor.view.dispatch(tr);
          }
          toast.success("อัปโหลดรูปแล้ว — อย่าลืมกรอกคำอธิบายรูป (ALT)");
        } catch (err) {
          const p = findUpload(editor, uploadId);
          if (p >= 0) editor.view.dispatch(editor.state.tr.delete(p, p + (editor.state.doc.nodeAt(p)?.nodeSize ?? 1)));
          if (!alreadyNotified(err)) toast.error(errorMessage(err) || "อัปโหลดรูปไม่สำเร็จ");
        } finally {
          uploadProgress.clear(uploadId);
          URL.revokeObjectURL(preview);
        }
      }
    },
    [editor, upload, toast],
  );
  useEffect(() => {
    filesRef.current = (files, pos) => void uploadFiles(files, pos);
  }, [uploadFiles]);

  const onBlockAction = useCallback((a: BlockAction) => {
    if (a === "upload-image") fileInput.current?.click();
    else setLibraryOpen(true);
  }, []);

  /* ---------------- link ---------------- */

  const linkState = useEditorState({
    editor,
    selector: (ctx) =>
      ctx.editor
        ? { href: (ctx.editor.getAttributes("link").href as string | undefined) ?? "", empty: ctx.editor.state.selection.empty }
        : { href: "", empty: true },
  });

  function applyLink(url: string, text: string) {
    if (!editor) return;
    setLinkOpen(false);
    const chain = editor.chain().focus();
    if (linkState?.href) {
      chain.extendMarkRange("link").setLink({ href: url }).run();
    } else if (editor.state.selection.empty) {
      chain.insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else {
      chain.setLink({ href: url }).run();
    }
  }

  if (!editor) {
    return <div className="ed-shell ed-loading" aria-busy="true" />;
  }

  return (
    <div className="ed-shell" data-invalid={invalid || undefined} data-readonly={!editable || undefined}>
      {editable ? (
        <Toolbar editor={editor} onLink={() => setLinkOpen(true)} onUpload={() => fileInput.current?.click()} onLibrary={() => setLibraryOpen(true)} onKeys={() => setKeysOpen(true)} />
      ) : null}
      {editable ? <TableBar editor={editor} /> : null}

      <BubbleMenu
        editor={editor}
        className="ed-bubble"
        options={{ placement: "top", offset: 8 }}
        shouldShow={({ editor: ed, state, from, to }) => {
          if (!ed.isEditable || from === to) return false;
          if (ed.isActive("image") || ed.isActive("codeBlock")) return false;
          return state.doc.textBetween(from, to).trim().length > 0;
        }}
      >
        <MarkButtons editor={editor} onLink={() => setLinkOpen(true)} compact />
      </BubbleMenu>

      <EditorContent editor={editor} className="ed-surface" />
      {editable ? <SlashMenu editor={editor} keyRef={slashKey} onAction={onBlockAction} /> : null}

      <div className="ed-footer" aria-live="off">
        <span>
          {stats.words.toLocaleString("th-TH")} คำ · {stats.chars.toLocaleString("th-TH")} ตัวอักษร
        </span>
        {editable ? (
          <button type="button" className="ed-footer-link" onClick={() => setKeysOpen(true)}>
            <Keyboard size={14} aria-hidden="true" /> คีย์ลัด ({isMac() ? "⌘" : "Ctrl"} + /)
          </button>
        ) : (
          <span>อ่านอย่างเดียว</span>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="adm-sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void uploadFiles(files);
        }}
      />
      <LinkDialog
        open={linkOpen}
        initialUrl={linkState?.href ?? ""}
        needsText={Boolean(linkState?.empty && !linkState?.href)}
        onSubmit={applyLink}
        onRemove={() => {
          setLinkOpen(false);
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
        }}
        onClose={() => {
          setLinkOpen(false);
          editor.commands.focus();
        }}
      />
      <MediaPickerDialog
        open={libraryOpen}
        title="แทรกรูปจากคลังสื่อ"
        confirmLabel="แทรกรูป"
        onClose={() => setLibraryOpen(false)}
        onPick={(m) => {
          setLibraryOpen(false);
          insertMedia(m);
        }}
      />
      <ShortcutsDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
  );
}

/* ---------------- toolbar pieces ---------------- */

function TB({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="ed-tb"
      aria-label={label}
      title={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MarkButtons({ editor, onLink, compact }: { editor: Editor; onLink: () => void; compact?: boolean }) {
  const s = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive("bold"),
      italic: ctx.editor.isActive("italic"),
      strike: ctx.editor.isActive("strike"),
      code: ctx.editor.isActive("code"),
      link: ctx.editor.isActive("link"),
      h2: ctx.editor.isActive("heading", { level: 2 }),
      h3: ctx.editor.isActive("heading", { level: 3 }),
      quote: ctx.editor.isActive("blockquote"),
    }),
  });
  const mod = isMac() ? "⌘" : "Ctrl+";
  return (
    <>
      <TB label={`ตัวหนา (${mod}B)`} active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={16} aria-hidden="true" />
      </TB>
      <TB label={`ตัวเอียง (${mod}I)`} active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={16} aria-hidden="true" />
      </TB>
      <TB label="ขีดฆ่า" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={16} aria-hidden="true" />
      </TB>
      <TB label={`โค้ดในบรรทัด (${mod}E)`} active={s.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code size={16} aria-hidden="true" />
      </TB>
      <TB label={`ลิงก์ (${mod}K)`} active={s.link} onClick={onLink}>
        <Link2 size={16} aria-hidden="true" />
      </TB>
      {compact ? (
        <>
          <span className="ed-tb-sep" aria-hidden="true" />
          <TB label="หัวข้อใหญ่ (H2)" active={s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={16} aria-hidden="true" />
          </TB>
          <TB label="หัวข้อย่อย (H3)" active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={16} aria-hidden="true" />
          </TB>
          <TB label="ข้อความอ้างอิง" active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={16} aria-hidden="true" />
          </TB>
        </>
      ) : null}
    </>
  );
}

function Toolbar({
  editor,
  onLink,
  onUpload,
  onLibrary,
  onKeys,
}: {
  editor: Editor;
  onLink: () => void;
  onUpload: () => void;
  onLibrary: () => void;
  onKeys: () => void;
}) {
  const s = useEditorState({
    editor,
    selector: (ctx) => ({
      canUndo: ctx.editor.can().undo(),
      canRedo: ctx.editor.can().redo(),
      h2: ctx.editor.isActive("heading", { level: 2 }),
      h3: ctx.editor.isActive("heading", { level: 3 }),
      h4: ctx.editor.isActive("heading", { level: 4 }),
      ul: ctx.editor.isActive("bulletList"),
      ol: ctx.editor.isActive("orderedList"),
      task: ctx.editor.isActive("taskList"),
      quote: ctx.editor.isActive("blockquote"),
      code: ctx.editor.isActive("codeBlock"),
    }),
  });
  const mod = isMac() ? "⌘" : "Ctrl+";
  return (
    <div className="ed-toolbar" role="toolbar" aria-label="เครื่องมือจัดรูปแบบ">
      <TB label={`เลิกทำ (${mod}Z)`} disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={16} aria-hidden="true" />
      </TB>
      <TB label={`ทำซ้ำ (${mod}Shift+Z)`} disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={16} aria-hidden="true" />
      </TB>
      <span className="ed-tb-sep" aria-hidden="true" />
      <TB label="หัวข้อใหญ่ (H2)" active={s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={16} aria-hidden="true" />
      </TB>
      <TB label="หัวข้อย่อย (H3)" active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 size={16} aria-hidden="true" />
      </TB>
      <TB label="หัวข้อย่อยระดับ 3 (H4)" active={s.h4} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
        <Heading4 size={16} aria-hidden="true" />
      </TB>
      <span className="ed-tb-sep" aria-hidden="true" />
      <MarkButtons editor={editor} onLink={onLink} />
      <span className="ed-tb-sep" aria-hidden="true" />
      <TB label="รายการแบบจุด" active={s.ul} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={16} aria-hidden="true" />
      </TB>
      <TB label="รายการแบบตัวเลข" active={s.ol} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={16} aria-hidden="true" />
      </TB>
      <TB label="รายการสิ่งที่ต้องทำ" active={s.task} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks size={16} aria-hidden="true" />
      </TB>
      <TB label="ข้อความอ้างอิง" active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={16} aria-hidden="true" />
      </TB>
      <TB label="บล็อกโค้ด" active={s.code} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code2 size={16} aria-hidden="true" />
      </TB>
      <TB label="แทรกตาราง" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableIcon size={16} aria-hidden="true" />
      </TB>
      <TB label="เส้นคั่น" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus size={16} aria-hidden="true" />
      </TB>
      <span className="ed-tb-sep" aria-hidden="true" />
      <TB label="อัปโหลดรูปภาพ" onClick={onUpload}>
        <ImagePlus size={16} aria-hidden="true" />
      </TB>
      <TB label="แทรกจากคลังสื่อ" onClick={onLibrary}>
        <Images size={16} aria-hidden="true" />
      </TB>
      <span className="ed-tb-grow" />
      <TB label={`คีย์ลัด (${mod}/)`} onClick={onKeys}>
        <Keyboard size={16} aria-hidden="true" />
      </TB>
    </div>
  );
}

function TableBar({ editor }: { editor: Editor }) {
  const inTable = useEditorState({ editor, selector: (ctx) => ctx.editor.isActive("table") });
  if (!inTable) return null;
  return (
    <div className="ed-tablebar" role="toolbar" aria-label="เครื่องมือตาราง">
      <span className="text-xs text-muted">ตาราง:</span>
      <TB label="เพิ่มแถวด้านล่าง" onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Rows3 size={15} aria-hidden="true" />
        <span className="ed-tb-text">+ แถว</span>
      </TB>
      <TB label="เพิ่มคอลัมน์ทางขวา" onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <Columns3 size={15} aria-hidden="true" />
        <span className="ed-tb-text">+ คอลัมน์</span>
      </TB>
      <TB label="ลบแถวนี้" onClick={() => editor.chain().focus().deleteRow().run()}>
        <span className="ed-tb-text">− แถว</span>
      </TB>
      <TB label="ลบคอลัมน์นี้" onClick={() => editor.chain().focus().deleteColumn().run()}>
        <span className="ed-tb-text">− คอลัมน์</span>
      </TB>
      <span className="ed-tb-sep" aria-hidden="true" />
      <TB label="จัดคอลัมน์ชิดซ้าย" onClick={() => setColumnAlign(editor, "left")}>
        <AlignLeft size={15} aria-hidden="true" />
      </TB>
      <TB label="จัดคอลัมน์กึ่งกลาง" onClick={() => setColumnAlign(editor, "center")}>
        <AlignCenter size={15} aria-hidden="true" />
      </TB>
      <TB label="จัดคอลัมน์ชิดขวา" onClick={() => setColumnAlign(editor, "right")}>
        <AlignRight size={15} aria-hidden="true" />
      </TB>
      <span className="ed-tb-sep" aria-hidden="true" />
      <TB label="ลบตาราง" onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 size={15} aria-hidden="true" />
      </TB>
    </div>
  );
}
