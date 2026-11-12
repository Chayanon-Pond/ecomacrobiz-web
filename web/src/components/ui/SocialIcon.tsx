import type { SocialLink } from "@/content/site";

/** Simplified monochrome glyphs (drawn for this project, not brand files). */
export function SocialIcon({
  id,
  className = "size-5",
}: {
  id: SocialLink["id"];
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    focusable: false as const,
  };
  switch (id) {
    case "line":
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 3C6.48 3 2 6.6 2 11.04c0 3.98 3.53 7.31 8.3 7.94.32.07.76.21.87.49.1.25.07.64.03.9l-.14.85c-.04.25-.2.98.86.53 1.06-.45 5.7-3.36 7.78-5.75C21.13 14.42 22 12.83 22 11.04 22 6.6 17.52 3 12 3Zm-3.6 10.4H6.5a.5.5 0 0 1-.5-.5V9.1a.5.5 0 0 1 1 0v3.3h1.4a.5.5 0 0 1 0 1Zm1.9-.5a.5.5 0 0 1-1 0V9.1a.5.5 0 0 1 1 0v3.8Zm4.6 0a.5.5 0 0 1-.9.3l-1.9-2.6v2.3a.5.5 0 0 1-1 0V9.1a.5.5 0 0 1 .9-.3l1.9 2.6V9.1a.5.5 0 0 1 1 0v3.8Zm3-2.4a.5.5 0 0 1 0 1h-1.4v.9h1.4a.5.5 0 0 1 0 1h-1.9a.5.5 0 0 1-.5-.5V9.1a.5.5 0 0 1 .5-.5h1.9a.5.5 0 0 1 0 1h-1.4v.9h1.4Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common} fill="currentColor">
          <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v15A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5v-15A1.5 1.5 0 0 0 19.5 3h-15Zm2.2 4.1a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM5.6 10.5h2.3V18H5.6v-7.5Zm4 0h2.2v1c.4-.7 1.3-1.2 2.5-1.2 2.3 0 2.9 1.4 2.9 3.4V18h-2.3v-3.8c0-1-.1-2-1.3-2s-1.6.9-1.6 2V18H9.6v-7.5Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common} fill="currentColor">
          <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg
          {...common}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
