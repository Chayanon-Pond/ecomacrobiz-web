"use client";

/**
 * Compatibility exports. The console chrome now lives in ./shell/ConsoleShell
 * (mounted by app/admin/(console)/layout.tsx after the server session check).
 * New code: import PageHeader / Spinner from "@/components/admin/ui".
 */
import { Spinner as UiSpinner } from "./ui/Spinner";

export { ConsoleShell as AdminShell } from "./shell/ConsoleShell";
export { PageHeader } from "./ui/PageHeader";

/** Old default: always shows a "กำลังโหลด…" status label. */
export function Spinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return <UiSpinner label={label} />;
}
