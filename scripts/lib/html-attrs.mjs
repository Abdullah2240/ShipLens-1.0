const HTML_TAG = /<html(?=[\s>/])([^>]*)>/i;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Attributes of the first <html ...> tag as an object, or null when there is none.
 * Handles any attribute order and single or double quotes.
 */
export function parseHtmlAttrs(html) {
  const match = HTML_TAG.exec(html);
  if (!match) return null;
  const attrs = {};
  for (const m of (match[1] ?? '').matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/**
 * True when some href equals prefix, or starts with `${prefix}/` or `${prefix}?`.
 */
export function hasLinkWithPrefix(html, prefix) {
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = m[1] ?? m[2] ?? m[3] ?? '';
    if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`)) {
      return true;
    }
  }
  return false;
}
