"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "../ui";

/**
 * Route entry for /admin/posts/new and /admin/posts/[id]. The editor page is
 * client-only (localStorage backups, matchMedia, Tiptap) and lazy: none of
 * its code is part of other routes.
 */
const PostEditorPage = dynamic(() => import("./PostEditorPage"), {
  ssr: false,
  loading: () => (
    <div className="grid gap-5" role="status" aria-label="กำลังโหลดตัวแก้ไขบทความ">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-12 w-3/4" />
      <Skeleton className="h-96 w-full" />
    </div>
  ),
});

export function PostEditorLoader({ edit = false }: { edit?: boolean }) {
  return <PostEditorPage edit={edit} />;
}
