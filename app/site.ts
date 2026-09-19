/**
 * Canonical URLs are only emitted when the deployment host is known, so local
 * and desktop builds never claim a public origin they do not own.
 */
function resolveSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export const siteUrl = resolveSiteUrl();

export function canonical(path: string) {
  return siteUrl ? { canonical: path } : undefined;
}
