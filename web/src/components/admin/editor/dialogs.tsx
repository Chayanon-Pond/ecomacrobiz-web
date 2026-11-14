"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input } from "../ui";
import { isMac, normalizeLink } from "./utils";

/** Link insert/edit dialog with URL validation. `needsText` when nothing is selected. */
export function LinkDialog({
  open,
  initialUrl,
  needsText,
  onSubmit,
  onRemove,
  onClose,
}: {
  open: boolean;
  initialUrl: string;
  needsText: boolean;
  onSubmit: (url: string, text: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const formId = useId();
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUrl(initialUrl);
      setText("");
      setError(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = normalizeLink(url);
    if ("error" in r) return setError(r.error);
    if (needsText && !text.trim()) return setError("กรุณากรอกข้อความที่จะแสดงเป็นลิงก์");
    onSubmit(r.url, text.trim());
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initialUrl ? "แก้ไขลิงก์" : "แทรกลิงก์"}
      description="ลิงก์ภายนอกจะเปิดในแท็บใหม่บนเว็บไซต์โดยอัตโนมัติ"
      footer={
        <>
          {initialUrl ? (
            <Button variant="danger" className="mr-auto" onClick={onRemove}>
              นำลิงก์ออก
            </Button>
          ) : null}
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" type="submit" form={formId}>
            {initialUrl ? "บันทึกลิงก์" : "แทรกลิงก์"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-3" noValidate>
        <Field label="URL" required error={error} hint="เช่น https://example.com, /knowledge/branding-vs-marketing หรือ mailto:hello@ecomacrobiz.com">
          {(p) => (
            <Input
              {...p}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        {needsText ? (
          <Field label="ข้อความลิงก์" required>
            {(p) => <Input {...p} value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
        ) : null}
      </form>
    </Dialog>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod = isMac() ? "⌘" : "Ctrl";
  const alt = isMac() ? "⌥" : "Alt";
  const rows: [string, string[]][] = [
    ["บันทึก", [mod, "S"]],
    ["ตัวหนา", [mod, "B"]],
    ["ตัวเอียง", [mod, "I"]],
    ["ขีดฆ่า", [mod, "Shift", "S"]],
    ["โค้ดในบรรทัด", [mod, "E"]],
    ["แทรก/แก้ไขลิงก์", [mod, "K"]],
    ["หัวข้อ H2 / H3 / H4", [mod, alt, "2 / 3 / 4"]],
    ["รายการแบบจุด", [mod, "Shift", "8"]],
    ["รายการแบบตัวเลข", [mod, "Shift", "7"]],
    ["ข้อความอ้างอิง", [mod, "Shift", "B"]],
    ["ขึ้นบรรทัดใหม่ในย่อหน้าเดียวกัน", ["Shift", "Enter"]],
    ["เลิกทำ / ทำซ้ำ", [mod, "Z / Shift+Z"]],
    ["เมนูแทรกบล็อก", ["/"]],
    ["แสดงคีย์ลัดนี้", [mod, "/"]],
  ];
  const md: [string, string][] = [
    ["## หัวข้อ", "หัวข้อ H2 (### = H3, #### = H4)"],
    ["- หรือ *", "รายการแบบจุด"],
    ["1.", "รายการแบบตัวเลข"],
    ["[ ]", "รายการสิ่งที่ต้องทำ"],
    ["> ", "ข้อความอ้างอิง"],
    ["```", "บล็อกโค้ด"],
    ["---", "เส้นคั่น"],
    ["**ข้อความ**", "ตัวหนา"],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="คีย์ลัดของตัวแก้ไข" size="lg">
      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">คีย์ลัด</h3>
          <dl className="ed-keys">
            {rows.map(([label, keys]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {keys.map((k) => (
                    <kbd key={k} className="adm-kbd">
                      {k}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">พิมพ์แบบ Markdown ได้ทันที</h3>
          <dl className="ed-keys">
            {md.map(([k, label]) => (
              <div key={k}>
                <dt>{label}</dt>
                <dd>
                  <kbd className="adm-kbd">{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Dialog>
  );
}
