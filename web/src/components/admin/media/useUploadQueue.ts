"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Media } from "@/lib/admin/types";
import { errorMessage } from "../SessionProvider";
import { rejectReason, useMediaUpload } from "./upload";

export type UploadItem = {
  id: number;
  name: string;
  size: number;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  media?: Media;
};

const CONCURRENCY = 3;

/**
 * Multi-file upload queue (max 3 in flight) with per-file progress.
 * `onUploaded` fires for every successful file.
 */
export function useUploadQueue(onUploaded?: (m: Media) => void) {
  const upload = useMediaUpload();
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const files = useRef(new Map<number, File>());
  const queue = useRef<number[]>([]);
  const seq = useRef(0);
  const running = useRef(0);
  const pumpRef = useRef<() => void>(() => {});
  const cb = useRef(onUploaded);
  useEffect(() => {
    cb.current = onUploaded;
    itemsRef.current = items;
  });

  const patch = useCallback((id: number, p: Partial<UploadItem>) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }, []);

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const id = queue.current.shift() as number;
      const file = files.current.get(id);
      if (!file) continue;
      running.current++;
      patch(id, { status: "uploading" });
      upload(file, { onProgress: (f) => patch(id, { progress: f }) })
        .then((m) => {
          patch(id, { status: "done", progress: 1, media: m });
          cb.current?.(m);
        })
        .catch((err) => patch(id, { status: "error", error: errorMessage(err) || "อัปโหลดไม่สำเร็จ" }))
        .finally(() => {
          running.current--;
          files.current.delete(id);
          pumpRef.current();
        });
    }
  }, [upload, patch]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const add = useCallback(
    (list: FileList | File[]) => {
      const next: UploadItem[] = [];
      for (const file of Array.from(list)) {
        const id = ++seq.current;
        const reason = rejectReason(file);
        if (!reason) {
          files.current.set(id, file);
          queue.current.push(id);
        }
        next.push({
          id,
          name: file.name,
          size: file.size,
          previewUrl: reason ? "" : URL.createObjectURL(file),
          progress: 0,
          status: reason ? "error" : "queued",
          error: reason ?? undefined,
        });
      }
      setItems((cur) => [...next, ...cur]);
      pump();
    },
    [pump],
  );

  const clearFinished = useCallback(() => {
    for (const x of itemsRef.current) {
      if ((x.status === "done" || x.status === "error") && x.previewUrl) URL.revokeObjectURL(x.previewUrl);
    }
    setItems((list) => list.filter((x) => x.status === "queued" || x.status === "uploading"));
  }, []);

  useEffect(
    () => () => {
      for (const x of itemsRef.current) if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
    },
    [],
  );

  const busy = items.some((x) => x.status === "queued" || x.status === "uploading");
  return { items, add, clearFinished, busy };
}
