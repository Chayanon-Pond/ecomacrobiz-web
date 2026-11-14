"use client";

import { useEffect, useState } from "react";
import type { UserRef } from "@/lib/admin/types";
import { useAdmin } from "../SessionProvider";

/** GET leads/assignees (active users with leads:write). Loaded once per mount; [] on error. */
export function useAssignees(enabled = true): UserRef[] | null {
  const { request } = useAdmin();
  const [list, setList] = useState<UserRef[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    request<{ data: UserRef[] }>("leads/assignees", { signal: ctrl.signal })
      .then((r) => setList(r.data ?? []))
      .catch(() => {
        if (!ctrl.signal.aborted) setList([]);
      });
    return () => ctrl.abort();
  }, [request, enabled]);
  return list;
}
