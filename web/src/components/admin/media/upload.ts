"use client";

/**
 * Media upload with progress. fetch() cannot report upload progress, so this
 * uses XMLHttpRequest against the same-origin proxy (/api/admin/media) with
 * the session's CSRF token. The token is read from GET /auth/me through the
 * session's own request() (never stored outside memory).
 */
import { useCallback, useRef } from "react";
import { ADMIN_API, ApiError } from "@/lib/admin/client";
import { formatBytes } from "@/lib/admin/format";
import { loginUrl } from "@/lib/admin/next-path";
import type { Media, SessionPayload } from "@/lib/admin/types";
import { useAdmin } from "../SessionProvider";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const MEDIA_TYPE_LABEL: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/avif": "AVIF",
  "image/gif": "GIF",
};

/** Thai reason the file cannot be uploaded, or null. */
export function rejectReason(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "รองรับเฉพาะไฟล์ JPEG, PNG, WebP, AVIF หรือ GIF";
  if (file.size > MAX_UPLOAD_BYTES) return `ไฟล์ใหญ่เกิน 8 MB (${formatBytes(file.size)})`;
  return null;
}

export type UploadOptions = {
  alt?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

function xhrUpload(file: File, csrf: string, opts: UploadOptions): Promise<{ status: number; body: string; retryAfter: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${ADMIN_API}/media`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, retryAfter: xhr.getResponseHeader("retry-after") });
    xhr.onerror = () => reject(new TypeError("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const fd = new FormData();
    fd.append("file", file);
    if (opts.alt?.trim()) fd.append("alt", opts.alt.trim());
    xhr.send(fd);
  });
}

function toError(status: number, body: string, retryAfter: string | null): ApiError {
  let code = "internal";
  let message =
    status === 413
      ? "ไฟล์มีขนาดใหญ่เกินกำหนด (สูงสุด 8 MB)"
      : status === 403
        ? "ไม่มีสิทธิ์อัปโหลดไฟล์"
        : status === 401
          ? "กรุณาเข้าสู่ระบบอีกครั้ง"
          : "อัปโหลดไม่สำเร็จ กรุณาลองใหม่";
  let fields: Record<string, string> = {};
  try {
    const j = JSON.parse(body) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
    if (j.error) {
      code = j.error.code ?? code;
      message = j.error.message || message;
      fields = j.error.fields ?? {};
    }
  } catch {
    /* non-JSON body */
  }
  const ra = Number(retryAfter);
  return new ApiError(status, code, message, fields, Number.isFinite(ra) && ra > 0 ? ra : null);
}

/** `upload(file, opts)` -> Media. Retries once with a fresh CSRF token on a non-permission 403. */
export function useMediaUpload() {
  const { request } = useAdmin();
  const csrf = useRef<string | null>(null);

  const token = useCallback(
    async (fresh: boolean) => {
      if (!csrf.current || fresh) {
        const r = await request<{ data: SessionPayload }>("auth/me");
        csrf.current = r.data.csrf_token;
      }
      return csrf.current;
    },
    [request],
  );

  return useCallback(
    async (file: File, opts: UploadOptions = {}): Promise<Media> => {
      const reason = rejectReason(file);
      if (reason) throw new ApiError(422, "validation_failed", reason);
      let res = await xhrUpload(file, await token(false), opts);
      if (res.status === 403) {
        const err = toError(res.status, res.body, res.retryAfter);
        if (err.code !== "forbidden") res = await xhrUpload(file, await token(true), opts);
      }
      if (res.status === 401) {
        window.location.assign(loginUrl(`${window.location.pathname}${window.location.search}`));
      }
      if (res.status < 200 || res.status >= 300) throw toError(res.status, res.body, res.retryAfter);
      return (JSON.parse(res.body) as { data: Media }).data;
    },
    [token],
  );
}
