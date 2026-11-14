"use client";

/**
 * Comment composer (top level, reply, edit in place).
 *
 * - auto-growing textarea, max chars from config with a counter near the limit
 * - Enter sends / Shift+Enter newline on fine pointers; on touch Enter is a
 *   newline and the paper-plane button sends
 * - reply: ONE mention chip token before the text (× or Backspace at the
 *   very start removes it -> reply_to_id null)
 * - emoji picker (lazy chunk), one image (upload with progress), honeypot,
 *   elapsed_ms from the first focus, light markdown hint
 * - submit is optimistic: the parent inserts the comment and resolves/rejects;
 *   on rejection the draft (text, chip, image) comes back with the error.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CommunityConfig, Me } from "@/lib/community/types";
import { Avatar } from "./Avatar";
import { CameraIcon, CloseIcon, SendIcon, SmileIcon } from "../engagement/icons";
import { composerFirstRow, composerShell, composerToolbar } from "./CommentsFrame";
import { charCount, chipRemovedByKey, insertAtCaret, type MentionChip } from "./mention";
import { checkImageFile, uploadCommentImage, type UploadedImage } from "./upload";
import { commentErrorMessage } from "./messages";

type Picker = typeof import("./EmojiPicker").EmojiPicker;

export type ComposerSubmit = {
  body: string;
  chip: MentionChip | null;
  image: UploadedImage | null;
  honeypot: string;
  elapsedMs: number;
};

const iconBtn =
  "grid size-11 place-items-center rounded-full text-subtle transition-colors hover:bg-white/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

function finePointer(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
}

export function Composer({
  me,
  config,
  mode,
  initialBody = "",
  initialChip = null,
  autoFocus = false,
  placeholder,
  onSubmit,
  onCancel,
  textareaId,
}: {
  me: Me;
  config: CommunityConfig;
  mode: "comment" | "reply" | "edit";
  initialBody?: string;
  initialChip?: MentionChip | null;
  autoFocus?: boolean;
  placeholder?: string;
  /** Resolves when accepted (the composer is already cleared); rejects to restore the draft. */
  onSubmit: (v: ComposerSubmit) => Promise<void>;
  onCancel?: () => void;
  textareaId?: string;
}) {
  const max = config.comment_max_chars || 2000;
  const [body, setBody] = useState(initialBody);
  const [chip, setChip] = useState<MentionChip | null>(initialChip);
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<{ C: Picker } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  // A restored draft (replayed after sign-in) was typed before the redirect.
  const firstFocus = useRef<number | null>(null);
  useEffect(() => {
    if (initialBody && mode !== "edit") firstFocus.current = performance.now() - 3000;
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const pickerWrap = useRef<HTMLDivElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const ids = useId();

  const count = charCount(body);
  const over = count > max;
  const canSend = !sending && !upload && !over && (body.trim().length > 0 || !!image);
  const isEdit = mode === "edit";

  // Auto-grow (fallback for browsers without `field-sizing: content`).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [body, ref]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [autoFocus, ref]);

  useEffect(() => () => uploadAbort.current?.abort(), []);

  // Picker: click outside closes.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pickerWrap.current?.contains(t) || emojiBtn.current?.contains(t)) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pickerOpen]);

  const rememberCaret = () => {
    const el = ref.current;
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const openPicker = async () => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    rememberCaret();
    if (!picker) {
      try {
        const m = await import("./EmojiPicker");
        setPicker({ C: m.EmojiPicker });
      } catch {
        setError("โหลดอีโมจิไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
    }
    setPickerOpen(true);
  };

  const insertEmoji = (emoji: string) => {
    const el = ref.current;
    const sel = caret.current ?? { start: body.length, end: body.length };
    const next = insertAtCaret(body, emoji, sel.start, sel.end);
    setBody(next.value);
    caret.current = { start: next.caret, end: next.caret };
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const closePicker = () => {
    setPickerOpen(false);
    emojiBtn.current?.focus();
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkImageFile(file, config.comment_image_max_mb || 5);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const preview = URL.createObjectURL(file);
    setUpload({ name: file.name, progress: 0, preview });
    const ctrl = new AbortController();
    uploadAbort.current = ctrl;
    try {
      const img = await uploadCommentImage(file, (p) => setUpload((u) => (u ? { ...u, progress: p } : u)), ctrl.signal);
      setImage(img);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(commentErrorMessage(err));
    } finally {
      URL.revokeObjectURL(preview);
      setUpload(null);
      uploadAbort.current = null;
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = () => {
    uploadAbort.current?.abort();
    setImage(null);
    ref.current?.focus();
  };

  const submit = async () => {
    if (!canSend) return;
    const snapshot = { body, chip, image };
    const elapsedMs = firstFocus.current ? performance.now() - firstFocus.current : 0;
    setSending(true);
    setError(null);
    setPickerOpen(false);
    if (!isEdit) {
      setBody("");
      setImage(null);
    }
    try {
      await onSubmit({ body: snapshot.body, chip: snapshot.chip, image: snapshot.image, honeypot, elapsedMs });
    } catch (err) {
      setBody(snapshot.body);
      setChip(snapshot.chip);
      setImage(snapshot.image);
      setError(commentErrorMessage(err));
      requestAnimationFrame(() => ref.current?.focus());
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (chipRemovedByKey(e.key, el.selectionStart, el.selectionEnd, !!chip)) {
      e.preventDefault();
      setChip(null);
      return;
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && finePointer()) {
      e.preventDefault();
      void submit();
    }
  };

  const errorId = `${ids}-error`;
  const hintId = `${ids}-hint`;
  const label =
    mode === "edit" ? "แก้ไขความคิดเห็น" : mode === "reply" ? `ตอบกลับ${chip ? ` ${chip.name}` : ""}` : "เขียนความคิดเห็น";

  return (
    <div className={`flex gap-[var(--cm-gap)] ${mode === "reply" ? "cm-in" : ""}`}>
      {!isEdit && <Avatar id={me.id} name={me.display_name} url={me.avatar_url} size={mode === "reply" ? 32 : 36} />}
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        aria-label={label}
      >
        <div className={composerShell}>
          <div className={composerFirstRow}>
            {chip && (
              <span className="cm-chip" data-chip>
                <span className="truncate">{chip.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setChip(null);
                    ref.current?.focus();
                  }}
                  aria-label={`เอาการกล่าวถึง ${chip.name} ออก`}
                  className="grid size-6 place-items-center rounded-full hover:bg-white/10"
                >
                  <CloseIcon className="size-3.5" />
                </button>
              </span>
            )}
            <textarea
              ref={ref}
              id={textareaId}
              value={body}
              rows={1}
              maxLength={max + 200}
              onChange={(e) => {
                setBody(e.target.value);
                if (error) setError(null);
              }}
              onFocus={() => {
                firstFocus.current ??= performance.now();
              }}
              onKeyDown={onKeyDown}
              onSelect={rememberCaret}
              onBlur={rememberCaret}
              placeholder={placeholder ?? (mode === "reply" ? "เขียนคำตอบ…" : "เขียนความคิดเห็น…")}
              aria-label={label}
              aria-invalid={over || !!error || undefined}
              aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
              className="cm-textarea min-h-[1.75rem] min-w-[8rem] flex-1 bg-transparent py-1 text-[0.95rem] leading-[1.7] text-fg placeholder:text-muted focus:outline-none"
            />
          </div>

          {(image || upload) && (
            <div className="px-4 pt-2">
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview / uploaded media */}
                <img
                  src={image?.url ?? upload?.preview}
                  alt="ตัวอย่างรูปภาพที่แนบ"
                  width={image?.width}
                  height={image?.height}
                  className={`block h-auto max-h-40 w-auto max-w-full rounded-xl border border-line ${upload ? "opacity-60" : ""}`}
                />
                {upload && (
                  <span className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-black/50" aria-hidden="true">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${Math.round(upload.progress * 100)}%` }}
                    />
                  </span>
                )}
                <button
                  type="button"
                  onClick={removeImage}
                  aria-label={upload ? "ยกเลิกการอัปโหลดรูปภาพ" : "เอารูปภาพออก"}
                  className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-line-strong bg-surface text-fg shadow"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
              {upload && (
                <p className="mt-1 text-xs text-subtle" role="status">
                  กำลังอัปโหลดรูปภาพ… {Math.round(upload.progress * 100)}%
                </p>
              )}
            </div>
          )}

          <div className={composerToolbar}>
            <p id={hintId} className="min-w-0 truncate text-xs text-subtle">
              {count > max - 200 ? (
                <span className={over ? "font-semibold text-rose-300" : ""} aria-live="polite">
                  {count.toLocaleString("th-TH")}/{max.toLocaleString("th-TH")} ตัวอักษร
                </span>
              ) : (
                <span>
                  <strong className="font-semibold">**ตัวหนา**</strong> · <em>*ตัวเอียง*</em> · วางลิงก์ได้
                </span>
              )}
            </p>
            <div className="relative flex shrink-0 items-center">
              {!isEdit && (
                <>
                  <button
                    ref={emojiBtn}
                    type="button"
                    onClick={openPicker}
                    aria-label="แทรกอีโมจิ"
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    className={iconBtn}
                  >
                    <SmileIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!image || !!upload}
                    aria-label="แนบรูปภาพ"
                    className={iconBtn}
                  >
                    <CameraIcon />
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => void pickFile(e.target.files?.[0])}
                  />
                </>
              )}
              {isEdit && onCancel && (
                <button type="button" onClick={onCancel} className="min-h-11 rounded-full px-3 text-sm font-semibold text-muted hover:text-fg">
                  ยกเลิก
                </button>
              )}
              <button
                type="submit"
                disabled={!canSend}
                aria-label={isEdit ? "บันทึกการแก้ไข" : mode === "reply" ? "ส่งคำตอบ" : "ส่งความคิดเห็น"}
                className={`${iconBtn} ${canSend ? "text-accent-soft hover:text-white" : ""}`}
              >
                <SendIcon />
              </button>
              {pickerOpen && picker && (
                <div ref={pickerWrap} className="absolute bottom-full right-0 z-30 mb-2">
                  <picker.C onPick={insertEmoji} onClose={closePicker} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Honeypot: invisible to people, tempting to bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <p id={errorId} role="alert" className="mt-1.5 pl-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        {isEdit && <p className="mt-1 pl-3 text-xs text-subtle">กด Esc เพื่อยกเลิก</p>}
      </form>
    </div>
  );
}
