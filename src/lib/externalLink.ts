/**
 * Turns a user-typed link into something safe to put in an <a href>.
 * Accepts http(s) links and bare domains ("drive.google.com/..."); anything else
 * (plain text, javascript:, mailto:) is not a clickable link and returns null.
 */
export function toExternalHref(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw || /\s/.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).href;
    } catch {
      return null;
    }
  }
  // "scheme:" that is not http(s) (javascript:, data:, mailto:) is refused.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]+:\d+(\/|$)/.test(raw)) return null;
  if (!/^[^/\s]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(raw)) return null;
  try {
    return new URL(`https://${raw}`).href;
  } catch {
    return null;
  }
}
