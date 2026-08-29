import type { FeedVideo } from "../types";

export function thumbnailFor(video: FeedVideo) {
  return video.thumbnailUrl || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
}

export function formatPublished(video: FeedVideo) {
  if (video.publishedText) {
    return video.duration ? `${video.publishedText} · ${video.duration}` : video.publishedText;
  }

  if (video.publishedAt) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(video.publishedAt);
  }

  return video.duration || "";
}

export function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

const apiTokenKey = "gretel.apiToken.v1";

export function getStoredApiToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");
    if (tokenFromUrl) {
      window.sessionStorage.setItem(apiTokenKey, tokenFromUrl);
      params.delete("token");
      const cleanSearch = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch}`);
      return tokenFromUrl;
    }
    return (
      window.sessionStorage.getItem(apiTokenKey) ||
      (window as unknown as { __GRETEL_API_TOKEN__?: string }).__GRETEL_API_TOKEN__ ||
      ""
    );
  } catch {
    return "";
  }
}

export function authedHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getStoredApiToken();
  return {
    ...extraHeaders,
    ...(token ? { "x-gretel-token": token } : {})
  };
}
