import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ConsoleShell } from "@/components/admin/shell/ConsoleShell";
import { ConsoleSkeleton, SessionUnavailable } from "@/components/admin/shell/SessionStates";
import { loginUrl } from "@/lib/admin/next-path";
import { checkAdminSession } from "@/lib/admin/session-server";

// Every request verifies the session against the API before any console UI renders.
export const instant = false;

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  // The fallback is a neutral skeleton (no user data); cookies()/headers() are read inside.
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <SessionGate>{children}</SessionGate>
    </Suspense>
  );
}

async function SessionGate({ children }: { children: ReactNode }) {
  const check = await checkAdminSession();
  if (check.kind === "unauth") redirect(loginUrl(check.next));
  if (check.kind === "error") return <SessionUnavailable message={check.message} />;
  return <ConsoleShell initial={check.session}>{children}</ConsoleShell>;
}
