const MAX_LENGTH = 512;
const PROBE_ORIGIN = 'http://localhost';

// Control characters (including tab, CR and LF) and backslashes. Browsers treat a
// backslash like a slash, so "/\evil.test" would become the protocol-relative
// "//evil.test".
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

/**
 * Returns `raw` when it is a safe same-origin path to send the user to after login, or
 * null. This is the groundwork for the open-redirect rule (WA-02): only a path that
 * starts with exactly one "/" passes, so absolute URLs ("https://..."), protocol-relative
 * ("//host"), scheme URLs ("javascript:") and backslash tricks ("/\host", "/%5Chost") are
 * all refused, as are control characters, dot segments and anything over 512 characters.
 * The check runs on both the raw and the percent-decoded text, and the result must still
 * resolve to the probe origin through the URL parser.
 *
 * Locale-prefixed paths such as "/ur/share/reports/<id>" are returned as given; callers
 * navigate to them without adding a locale.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (UNSAFE_CHARS.test(raw)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (UNSAFE_CHARS.test(decoded)) return null;

  // Empty, "." and ".." segments in the path part: "//host", "/en/../x", "/%2F%2Fhost".
  const pathname = decoded.split(/[?#]/, 1)[0] ?? '';
  const segments = pathname.split('/').slice(1);
  if (segments.some((s, i) => s === '.' || s === '..' || (s === '' && i < segments.length - 1))) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;

  return raw;
}
