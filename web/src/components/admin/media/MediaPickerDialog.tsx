"use client";

import { useState } from "react";
import type { Media } from "@/lib/admin/types";
import { Button, Dialog } from "../ui";
import { MediaLibrary } from "./MediaLibrary";

/**
 * The media library as a picker ("แทรกจากคลังสื่อ", cover picker).
 * Click selects, double click or "เลือกรูปนี้" confirms; uploads made here
 * are selected automatically.
 */
export function MediaPickerDialog({
  open,
  onClose,
  onPick,
  title = "เลือกจากคลังสื่อ",
  confirmLabel = "เลือกรูปนี้",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: Media) => void;
  title?: string;
  confirmLabel?: string;
}) {
  const [selected, setSelected] = useState<Media | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected(null);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="คลิกเพื่อเลือก ดับเบิลคลิกเพื่อเลือกทันที หรือลากไฟล์มาวางเพื่ออัปโหลด"
      size="lg"
      className="md-picker"
      footer={
        <>
          <p className="mr-auto hidden min-w-0 truncate text-sm text-muted sm:block">
            {selected ? selected.original_name : "ยังไม่ได้เลือกไฟล์"}
          </p>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {open ? (
        <MediaLibrary mode="picker" selectedId={selected?.id ?? null} onSelect={setSelected} onOpen={onPick} />
      ) : null}
    </Dialog>
  );
}
