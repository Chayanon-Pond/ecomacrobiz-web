/**
 * Member avatar: the processed image when there is one, else coloured
 * initials (lib/community/avatar.ts); deleted accounts / deleted comments get
 * a neutral glyph. Decorative (the name is always shown next to it).
 */
import { avatarColor, initials } from "@/lib/community/avatar";
import { PersonIcon } from "../engagement/icons";

export function Avatar({
  id,
  name,
  url,
  size = 36,
  neutral = false,
}: {
  id?: string | null;
  name?: string | null;
  url?: string | null;
  size?: number;
  neutral?: boolean;
}) {
  const style = { width: size, height: size };
  if (neutral || !id || !name) {
    return (
      <span
        aria-hidden="true"
        style={style}
        className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-subtle ring-1 ring-line"
      >
        <PersonIcon className="size-[55%]" />
      </span>
    );
  }
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small API media; next/image would need remotePatterns per env
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={style}
        className="shrink-0 rounded-full bg-surface-2 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, backgroundColor: avatarColor(id), fontSize: Math.round(size * 0.42) }}
      className="grid shrink-0 select-none place-items-center rounded-full font-semibold leading-none text-white"
    >
      {initials(name)}
    </span>
  );
}
