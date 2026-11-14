"use client";

/**
 * Hand-built emoji picker (lazy chunk, loaded on the first click on the
 * emoji button). ~150 common emoji in 4 tabs; tabs and grid are keyboard
 * navigable (arrows, Home/End, Enter/Space inserts, Esc closes).
 */
import { useEffect, useRef, useState } from "react";

const GROUPS: { id: string; label: string; emoji: string }[] = [
  {
    id: "smileys",
    label: "หน้ายิ้ม",
    emoji:
      "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤯 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😲 🥺 😢 😭 😱 😤 😡",
  },
  {
    id: "gestures",
    label: "ท่าทาง",
    emoji:
      "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 👏 🙌 👐 🤲 🤝 🙏 💪 🧠 👀 🙋 🙆 🙅 🤷 🤦 💁 🙇",
  },
  {
    id: "hearts",
    label: "หัวใจ",
    emoji:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💯 ✨ ⭐ 🌟 🔥 💥 ✅ ❌ ❗ ❓ 💡 🎉 🎊",
  },
  {
    id: "things",
    label: "สิ่งของ",
    emoji:
      "📈 📊 💼 💰 💸 🏆 🎯 🚀 📌 📎 📝 📚 💻 📱 ⏰ 📣 🛒 🎁 ☕ 🍵 🍜 🍕 🍰 🌱 🌸 🌈 ☀️ 🌙 🇹🇭 🐶 🐱",
  },
];

const COLS = 8;

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const [index, setIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = GROUPS[tab].emoji.split(" ");
  const focusCell = useRef(false);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, []);

  useEffect(() => {
    if (!focusCell.current) return;
    focusCell.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [index, tab]);

  const onGridKey = (e: React.KeyboardEvent) => {
    let next = index;
    if (e.key === "ArrowRight") next = Math.min(list.length - 1, index + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "ArrowDown") next = Math.min(list.length - 1, index + COLS);
    else if (e.key === "ArrowUp") next = Math.max(0, index - COLS);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    } else return;
    e.preventDefault();
    focusCell.current = true;
    setIndex(next);
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    let next = tab;
    if (e.key === "ArrowRight") next = (tab + 1) % GROUPS.length;
    else if (e.key === "ArrowLeft") next = (tab - 1 + GROUPS.length) % GROUPS.length;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    } else return;
    e.preventDefault();
    setTab(next);
    setIndex(0);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="dialog"
      aria-label="เลือกอีโมจิ"
      className="cm-in w-[min(20.5rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface p-2 shadow-2xl shadow-black/60"
    >
      <div role="tablist" aria-label="หมวดอีโมจิ" className="flex gap-1 border-b border-line pb-1.5" onKeyDown={onTabKey}>
        {GROUPS.map((g, i) => (
          <button
            key={g.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`emoji-tab-${g.id}`}
            aria-selected={tab === i}
            aria-controls="emoji-panel"
            tabIndex={tab === i ? 0 : -1}
            onClick={() => {
              setTab(i);
              setIndex(0);
            }}
            className="min-h-9 flex-1 rounded-full px-2 text-xs font-semibold text-subtle transition-colors hover:text-fg aria-selected:bg-surface-2 aria-selected:text-fg"
          >
            {g.label}
          </button>
        ))}
      </div>
      <div
        ref={gridRef}
        id="emoji-panel"
        role="tabpanel"
        aria-labelledby={`emoji-tab-${GROUPS[tab].id}`}
        className="mt-1.5 grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain"
        data-lenis-prevent
        onKeyDown={onGridKey}
      >
        {list.map((emoji, i) => (
          <button
            key={`${tab}-${i}`}
            type="button"
            tabIndex={i === index ? 0 : -1}
            aria-label={emoji}
            onClick={() => onPick(emoji)}
            onFocus={() => setIndex(i)}
            className="grid aspect-square place-items-center rounded-lg text-[1.35rem] leading-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
