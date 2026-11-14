/**
 * Comment image upload (POST /uploads/comment-image) with progress — fetch
 * has no upload progress, so this uses XMLHttpRequest. Client-side checks
 * mirror the API (JPEG/PNG/WebP, ≤ config.comment_image_max_mb).
 */
import { COMMUNITY_API, CommunityError } from "@/lib/community/client";
import { getCsrf } from "@/lib/community/session";

export type UploadedImage = { id: string; url: string; width: number; height: number };

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Returns a Thai error or null when the file may be uploaded. */
export function checkImageFile(file: { type: string; size: number }, maxMb: number): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP";
  if (file.size > maxMb * 1024 * 1024) return `รูปภาพต้องมีขนาดไม่เกิน ${maxMb} MB`;
  if (file.size === 0) return "ไฟล์รูปภาพว่างเปล่า";
  return null;
}

export function uploadCommentImage(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${COMMUNITY_API}/uploads/comment-image`);
    xhr.setRequestHeader("accept", "application/json");
    const csrf = getCsrf();
    if (csrf) xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let json: { data?: UploadedImage; error?: { code?: string; message?: string; fields?: Record<string, string> } } = {};
      try {
        json = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.data) {
        resolve(json.data);
        return;
      }
      const ra = Number(xhr.getResponseHeader("retry-after"));
      reject(
        new CommunityError(
          xhr.status,
          json.error?.code ?? "internal",
          json.error?.fields?.file || json.error?.message || "อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่",
          json.error?.fields ?? {},
          Number.isFinite(ra) && ra > 0 ? ra : null,
        ),
      );
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
