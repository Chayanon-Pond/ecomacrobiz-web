"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { filterBlocks, type BlockAction, type BlockItem } from "./blocks";

type SlashState = { query: string; from: number; to: number } | null;

function readSlash(editor: Editor): SlashState {
  const { selection } = editor.state;
  const { $from, empty } = selection;
  if (!empty || !editor.isEditable || $from.parent.type.name !== "paragraph") return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
  if (!m) return null;
  return { query: m[1], from: $from.pos - m[1].length - 1, to: $from.pos };
}

/**
 * "/" command menu. Keyboard is routed here from editorProps.handleKeyDown via
 * `keyRef` (ArrowUp/Down, Enter/Tab, Escape).
 */
export function SlashMenu({
  editor,
  keyRef,
  onAction,
}: {
  editor: Editor;
  keyRef: React.RefObject<((e: KeyboardEvent) => boolean) | null>;
  onAction: (a: BlockAction) => void;
}) {
  const slash = useEditorState({ editor, selector: (ctx) => readSlash(ctx.editor) });
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const items = useMemo(() => (slash ? filterBlocks(slash.query) : []), [slash]);
  const open = slash !== null && dismissed !== slash.from && items.length > 0;

  if (slash && slash.query !== lastQuery) {
    setLastQuery(slash.query);
    setActive(0);
  }
  if (!slash && dismissed !== null) setDismissed(null);

  const runRef = useRef<(item: BlockItem) => void>(() => {});
  useEffect(() => {
    runRef.current = (item: BlockItem) => {
      if (!slash) return;
      editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run();
      const r = item.run(editor);
      if (r) onAction(r);
    };
  });

  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!open || !slash) return false;
      if (e.key === "ArrowDown") {
        setActive((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setActive((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const item = items[Math.min(active, items.length - 1)];
        if (item) runRef.current(item);
        return true;
      }
      if (e.key === "Escape") {
        setDismissed(slash.from);
        return true;
      }
      return false;
    };
    return () => {
      keyRef.current = null;
    };
  }, [open, slash, items, active, keyRef]);

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !slash) return;
    const c = editor.view.coordsAtPos(slash.from);
    const h = menu.current?.offsetHeight ?? 320;
    const w = menu.current?.offsetWidth ?? 288;
    const below = c.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, c.top - h - 6) : below;
    const left = Math.min(Math.max(8, c.left), window.innerWidth - w - 8);
    setPos({ top, left });
  }, [open, slash, editor, items.length]);

  useEffect(() => {
    menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  return (
    <div
      ref={menu}
      className="ed-slash"
      role="listbox"
      aria-label="แทรกบล็อก"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="ed-slash-head">{slash?.query ? `ค้นหา “${slash.query}”` : "แทรกบล็อก"}</p>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={i === active}
            className="ed-slash-item"
            onMouseEnter={() => setActive(i)}
            onClick={() => runRef.current(item)}
          >
            <span className="ed-slash-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-fg">{item.label}</span>
              <span className="block truncate text-xs text-muted">{item.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
