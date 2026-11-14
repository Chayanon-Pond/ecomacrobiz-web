/**
 * Inline SVG icons for engagement UI. No hooks, no client APIs: rendered by
 * server components (cards, static comments) and by the client island alike.
 */
type IconProps = { className?: string };

const base = {
  "aria-hidden": true,
  focusable: false,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function EyeIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.2 12s3.6-6.5 9.8-6.5 9.8 6.5 9.8 6.5-3.6 6.5-9.8 6.5S2.2 12 2.2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function BubbleIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20.5 11.6c0 4.2-3.8 7.4-8.5 7.4-1.1 0-2.2-.2-3.2-.5L4 20l1.3-3.6c-1.1-1.3-1.8-3-1.8-4.8C3.5 7.4 7.3 4.2 12 4.2s8.5 3.2 8.5 7.4Z" />
    </svg>
  );
}

export function HeartIcon({ className = "size-4", filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.5 2.8C19.5 15.6 12 20 12 20Z" />
    </svg>
  );
}

export function ThumbIcon({ className = "size-4", filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M7.5 10.5v9H4.8a.8.8 0 0 1-.8-.8v-7.4c0-.4.4-.8.8-.8h2.7Z" />
      <path d="M7.5 10.5 11 3.8c1.3 0 2.3 1.1 2.1 2.4l-.5 3.3h5.2c1.2 0 2.1 1.1 1.9 2.3l-1.1 6.1c-.2.9-1 1.6-1.9 1.6H7.5" />
    </svg>
  );
}

export function MoreIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className} fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

export function SendIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 12 3 4.5 21 12 3 19.5 4 12Zm0 0h8" />
    </svg>
  );
}

export function CameraIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8.2c0-.9.7-1.6 1.6-1.6h1.9l1.4-2h6.2l1.4 2h1.9c.9 0 1.6.7 1.6 1.6v9.6c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6V8.2Z" />
      <circle cx="12" cy="12.8" r="3.4" />
    </svg>
  );
}

export function SmileIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.2c.8 1.2 2 1.9 3.5 1.9s2.7-.7 3.5-1.9" />
      <path d="M9.2 9.6h.01M14.8 9.6h.01" strokeWidth={2.6} />
    </svg>
  );
}

export function CloseIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function PersonIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
    </svg>
  );
}
