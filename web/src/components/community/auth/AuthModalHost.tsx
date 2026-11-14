"use client";

/**
 * Imperative host for the auth modal (lazy chunk loaded by openAuth()).
 * Renders into its own body-level root, so it works from any page without a
 * provider. One modal at a time: a second call while open gets the same promise.
 */
import { createRoot, type Root } from "react-dom/client";
import type { Me } from "@/lib/community/types";
import type { OpenAuthOptions } from "./open-auth";
import { AuthModal } from "./AuthModal";

let current: Promise<Me | null> | null = null;

export function showAuthModal(options: OpenAuthOptions): Promise<Me | null> {
  if (current) return current;
  const returnFocus =
    options.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  current = new Promise<Me | null>((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-community-auth", "");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const onClosed = (me: Me | null) => {
      root.unmount();
      host.remove();
      current = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(me);
    };
    root.render(<AuthModal options={options} host={host} onClosed={onClosed} />);
  });
  return current;
}
