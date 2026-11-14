/**
 * Entry point used by every community feature to require sign-in.
 *
 * CONTRACT (owned by the auth/account engineer; the comments engineer only
 * calls it): lazily imports the auth modal (never part of the initial
 * bundle), opens it, and resolves with the signed-in member or null when the
 * visitor closes it. `pending` is saved with savePendingAction() before a
 * Google redirect so the article can replay it after the round-trip.
 */
import type { Me, PendingAction } from "@/lib/community/types";

export type AuthReason = "like" | "comment" | "reply" | "report" | "generic";

export type OpenAuthOptions = {
  reason: AuthReason;
  /** Initial tab. Default "login". */
  tab?: "login" | "register";
  /** Replayed after a Google redirect (and passed back to the caller otherwise). */
  pending?: PendingAction;
  /** Element to return focus to on close (defaults to document.activeElement). */
  returnFocus?: HTMLElement | null;
};

export async function openAuth(options: OpenAuthOptions): Promise<Me | null> {
  const mod = await import("./AuthModalHost");
  return mod.showAuthModal(options);
}
