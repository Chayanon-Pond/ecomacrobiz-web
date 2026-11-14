/**
 * Tiny engagement loader (part of the initial article bundle — keep it small,
 * no imports beyond the dynamic one).
 *
 *  - Sends the view beacon once per page view, after load + idle.
 *  - Activates the islands (dynamic import of ./runtime) when the comments
 *    section comes within ~600px of the viewport, on the first pointer/focus
 *    on any `[data-engage]` control, or right away after a Google sign-in
 *    round-trip (`#community=…`).
 *  - A click on a not-yet-live control is swallowed and recorded as an
 *    intent; the island replays it once it is live.
 */

export type IslandScope = "stats" | "comments";
export type Intent = { scope: IslandScope; action: string; id?: string; value?: string };

type Runtime = typeof import("./runtime");

let runtime: Promise<Runtime> | null = null;
let activated = false;
const activators = new Set<() => void>();
const intents: Intent[] = [];
let oauthOutcome: string | null = null;
const viewed = new Set<string>();
let listening = 0;

export function loadRuntime(): Promise<Runtime> {
  runtime ??= import("./runtime").catch((err) => {
    runtime = null;
    throw err;
  });
  return runtime;
}

function activate() {
  if (activated) return;
  activated = true;
  for (const fn of activators) fn();
}

/** Lets an island retry after a failed boot (network error). */
export function resetActivation() {
  activated = false;
}

/** Registers an island; `fn` runs once on activation (immediately if already active). */
export function onActivate(fn: () => void): () => void {
  activators.add(fn);
  if (activated) fn();
  return () => activators.delete(fn);
}

export function takeIntent(scope: IslandScope): Intent | null {
  const i = intents.findIndex((x) => x.scope === scope);
  return i === -1 ? null : intents.splice(i, 1)[0];
}

/** `#community=<outcome>` captured at startup (read once by the comments island). */
export function takeOAuthOutcome(): string | null {
  const o = oauthOutcome;
  oauthOutcome = null;
  return o;
}

function engageTarget(e: Event): HTMLElement | null {
  const el = (e.target as Element | null)?.closest?.("[data-engage]") as HTMLElement | null;
  // Controls inside an island that is already live handle themselves.
  if (!el || el.closest("[data-live]")) return null;
  return el;
}

function onEarly(e: Event) {
  if (engageTarget(e)) activate();
}

function onClick(e: MouseEvent) {
  const el = engageTarget(e);
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const scope = (el.closest("[data-island]") as HTMLElement | null)?.dataset.island;
  const d = el.dataset;
  // Keep only the latest intent per island (a double tap must not replay twice).
  for (let i = intents.length - 1; i >= 0; i--) if (intents[i].scope === scope) intents.splice(i, 1);
  intents.push({ scope: scope === "stats" ? "stats" : "comments", action: d.engage!, id: d.id, value: d.value });
  activate();
}

function sendView(slug: string) {
  if (viewed.has(slug)) return;
  viewed.add(slug);
  const send = () => {
    fetch(`/api/community/posts/${encodeURIComponent(slug)}/views`, {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  };
  const idle = () =>
    "requestIdleCallback" in window ? window.requestIdleCallback(send, { timeout: 4000 }) : setTimeout(send, 1500);
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

/** Activates when `el` (the comments island) comes within ~600px of the viewport. */
export function observeNear(el: Element): () => void {
  if (!("IntersectionObserver" in window)) {
    activate();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        io.disconnect();
        activate();
      }
    },
    { rootMargin: "600px 0px" },
  );
  io.observe(el);
  return () => io.disconnect();
}

/** Called by each island on mount; sets up the shared listeners once. */
export function initEngagement(slug: string): () => void {
  sendView(slug);

  const hash = location.hash;
  if (hash.startsWith("#community=")) {
    oauthOutcome = decodeURIComponent(hash.slice("#community=".length));
    activate();
  }

  if (listening++ === 0) {
    document.addEventListener("pointerdown", onEarly, true);
    document.addEventListener("focusin", onEarly, true);
    document.addEventListener("click", onClick, true);
  }
  return () => {
    if (--listening === 0) {
      document.removeEventListener("pointerdown", onEarly, true);
      document.removeEventListener("focusin", onEarly, true);
      document.removeEventListener("click", onClick, true);
    }
  };
}
