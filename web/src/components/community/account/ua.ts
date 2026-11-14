/** Human label for a session's User-Agent ("Chrome บน Windows"). Pure. */
export function describeUserAgent(ua: string): string {
  if (!ua) return "อุปกรณ์ที่ไม่รู้จัก";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Line\//.test(ua)
          ? "LINE"
          : /FBAN|FBAV/.test(ua)
            ? "Facebook"
            : /Firefox\/|FxiOS/.test(ua)
              ? "Firefox"
              : /Chrome\/|CriOS/.test(ua)
                ? "Chrome"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : /curl\//.test(ua)
                    ? "curl"
                    : "เบราว์เซอร์";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  return os ? `${browser} บน ${os}` : browser;
}
