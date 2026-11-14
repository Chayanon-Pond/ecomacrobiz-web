"use client";

import { useState } from "react";
import type { Media } from "@/lib/admin/types";
import { useAdmin } from "../SessionProvider";
import { NoAccess, PageHeader } from "../ui";
import { MediaDetails } from "./MediaDetails";
import { MediaLibrary } from "./MediaLibrary";

export function MediaPage() {
  const { can } = useAdmin();
  const [open, setOpen] = useState<Media | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  if (!can("media:read")) {
    return (
      <>
        <PageHeader title="คลังสื่อ" />
        <NoAccess />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="คลังสื่อ"
        description="รูปภาพทั้งหมดที่ใช้ในบทความ · ลากไฟล์มาวางเพื่ออัปโหลดได้หลายไฟล์พร้อมกัน"
      />
      <MediaLibrary mode="page" onOpen={setOpen} reloadKey={reloadKey} />
      <MediaDetails media={open} onClose={() => setOpen(null)} onChanged={() => setReloadKey((n) => n + 1)} />
    </>
  );
}
