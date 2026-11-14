import type { CSSProperties } from "react";

/** Up to two initials from a name (Latin) or the first Thai/other character; falls back to the email. */
export function initials(name: string, email = ""): string {
  const src = name.trim() || email.split("@")[0] || "?";
  const words = src.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2 && /^[A-Za-z]/.test(words[0]) && /^[A-Za-z]/.test(words[1])) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return Array.from(src)[0]?.toUpperCase() ?? "?";
}

function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Decorative by default (the name is shown next to it). */
export function Avatar({
  name,
  email = "",
  size = "md",
  label,
}: {
  name: string;
  email?: string;
  size?: "sm" | "md" | "lg";
  /** Set when the avatar stands alone and must be announced. */
  label?: string;
}) {
  return (
    <span
      className="adm-avatar"
      data-size={size === "md" ? undefined : size}
      style={{ "--adm-av-h": hue(email || name) } as CSSProperties}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {initials(name, email)}
    </span>
  );
}
