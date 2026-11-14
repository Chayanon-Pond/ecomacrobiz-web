"use client";

/**
 * Cloudflare Turnstile widget, loaded lazily (only when this component
 * mounts, i.e. inside the auth form and only when the site key is set and
 * the API has Turnstile on). Reports the token via onToken ("" = none/expired).
 */
import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY } from "./config";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    loader = new Promise<TurnstileApi>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
      s.onerror = () => {
        loader = null;
        reject(new Error("turnstile"));
      };
      document.head.appendChild(s);
    });
  }
  return loader;
}

export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let alive = true;
    loadTurnstile()
      .then((ts) => {
        if (!alive || !ref.current) return;
        idRef.current = ts.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          language: "th",
          callback: (t: string) => onTokenRef.current(t),
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => onTokenRef.current(""));
    return () => {
      alive = false;
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current);
      idRef.current = null;
    };
  }, []);

  // Tokens are single use: reset after each failed submit.
  useEffect(() => {
    if (resetKey && idRef.current && window.turnstile) {
      window.turnstile.reset(idRef.current);
      onTokenRef.current("");
    }
  }, [resetKey]);

  return <div ref={ref} className="min-h-[65px]" />;
}
