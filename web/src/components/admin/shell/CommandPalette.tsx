"use client";

/**
 * Cmd/Ctrl+K command palette: navigate + quick actions, filtered by the
 * user's permissions (cosmetic). Combobox + listbox pattern with
 * aria-activedescendant; ↑/↓ move, Enter runs, Esc closes.
 */
import { Download, FilePlus2, LogOut, Moon, Search, Sun, UserPlus, UserRound, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { downloadResponse, toApiError } from "@/lib/admin/client";
import type { Permission } from "@/lib/admin/permissions";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { useToast } from "../ui/Toast";
import { NAV_GROUPS } from "./nav";
import { useTheme } from "./prefs";

type Command = {
  id: string;
  group: "ไปที่" | "การทำงาน";
  label: string;
  hint?: string;
  keywords: string;
  icon: LucideIcon;
  anyOf?: Permission[];
  run: () => void | Promise<void>;
};

function norm(s: string) {
  return s.toLowerCase().normalize("NFC");
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { canAny, requestRaw, logout } = useAdmin();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setActive(0);
    }
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const exportLeads = useCallback(async () => {
    toast.info("กำลังส่งออก Leads…");
    try {
      const res = await requestRaw("leads/export.csv");
      if (!res.ok) throw await toApiError(res);
      await downloadResponse(res, "leads.csv");
      toast.success("ดาวน์โหลดไฟล์ CSV แล้ว");
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ส่งออกไม่สำเร็จ");
    }
  }, [requestRaw, toast]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => ({
        id: `nav:${i.href}`,
        group: "ไปที่" as const,
        label: i.label,
        hint: i.en,
        keywords: `${i.label} ${i.en} ${i.keywords ?? ""} ${i.href}`,
        icon: i.icon,
        anyOf: i.anyOf,
        run: () => router.push(i.href),
      })),
    );
    const actions: Command[] = [
      {
        id: "new-post",
        group: "การทำงาน",
        label: "เขียนบทความใหม่",
        keywords: "new post create article เขียน บทความ",
        icon: FilePlus2,
        anyOf: ["posts:write"],
        run: () => router.push("/admin/posts/new"),
      },
      {
        id: "invite",
        group: "การทำงาน",
        label: "เชิญผู้ใช้",
        keywords: "invite user team เชิญ ผู้ใช้",
        icon: UserPlus,
        anyOf: ["users:manage"],
        run: () => router.push("/admin/users?invite=1"),
      },
      {
        id: "export-leads",
        group: "การทำงาน",
        label: "ส่งออก Leads (CSV)",
        keywords: "export csv download leads ส่งออก",
        icon: Download,
        anyOf: ["leads:export"],
        run: exportLeads,
      },
      {
        id: "account",
        group: "การทำงาน",
        label: "บัญชีของฉัน",
        hint: "รหัสผ่าน · อุปกรณ์",
        keywords: "account profile password session บัญชี รหัสผ่าน",
        icon: UserRound,
        run: () => router.push("/admin/account"),
      },
      {
        id: "theme",
        group: "การทำงาน",
        label: theme === "dark" ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด",
        keywords: "theme dark light ธีม สว่าง มืด",
        icon: theme === "dark" ? Sun : Moon,
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      {
        id: "logout",
        group: "การทำงาน",
        label: "ออกจากระบบ",
        keywords: "logout sign out ออก",
        icon: LogOut,
        run: logout,
      },
    ];
    return [...nav, ...actions].filter((c) => !c.anyOf || !c.anyOf.length || canAny(...c.anyOf));
  }, [router, exportLeads, theme, setTheme, logout, canAny]);

  const filtered = useMemo(() => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return commands;
    return commands.filter((c) => {
      const hay = norm(`${c.label} ${c.hint ?? ""} ${c.keywords}`);
      return terms.every((t) => hay.includes(t));
    });
  }, [commands, q]);

  const safeActive = Math.min(active, Math.max(0, filtered.length - 1));

  useEffect(() => {
    document.getElementById(`${listId}-opt-${safeActive}`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive, listId]);

  function run(c: Command | undefined) {
    if (!c) return;
    onClose();
    void c.run();
  }

  let lastGroup = "";
  return (
    <dialog
      ref={ref}
      className="adm-cmdk"
      aria-label="ค้นหาคำสั่งและหน้า"
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <>
          <div className="adm-cmdk-input">
            <Search size={18} aria-hidden="true" className="text-subtle" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered.length ? `${listId}-opt-${safeActive}` : undefined}
              aria-label="พิมพ์เพื่อค้นหาหน้า หรือคำสั่ง"
              placeholder="ไปที่หน้า หรือสั่งงาน… (เช่น เชิญผู้ใช้)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((safeActive + 1) % Math.max(1, filtered.length));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((safeActive - 1 + filtered.length) % Math.max(1, filtered.length));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  run(filtered[safeActive]);
                }
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="adm-kbd">Esc</kbd>
          </div>
          <div id={listId} role="listbox" aria-label="ผลลัพธ์" className="adm-cmdk-list">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">ไม่พบคำสั่งที่ตรงกับ “{q}”</p>
            ) : (
              filtered.map((c, i) => {
                const Icon = c.icon;
                const header = c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                return (
                  <div key={c.id} role="presentation">
                    {header ? (
                      <div className="adm-cmdk-group" role="presentation">
                        {header}
                      </div>
                    ) : null}
                    <div
                      id={`${listId}-opt-${i}`}
                      role="option"
                      aria-selected={i === safeActive}
                      className="adm-cmdk-item"
                      onMouseMove={() => i !== safeActive && setActive(i)}
                      onClick={() => run(c)}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span>{c.label}</span>
                      {c.hint ? <span className="adm-cmdk-hint">{c.hint}</span> : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="adm-cmdk-foot" aria-hidden="true">
            <span>
              <kbd className="adm-kbd">↑</kbd>
              <kbd className="adm-kbd">↓</kbd> เลื่อน
            </span>
            <span>
              <kbd className="adm-kbd">Enter</kbd> เลือก
            </span>
            <span>
              <kbd className="adm-kbd">Esc</kbd> ปิด
            </span>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
