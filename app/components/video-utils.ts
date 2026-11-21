import type React from "react";
import type { FeedVideo } from "../types";

export function isPlaylistCard(video: Pick<FeedVideo, "itemType">): boolean {
  return video.itemType === "playlist";
}

export function thumbnailFor(video: FeedVideo) {
  if (video.thumbnailCacheUrl) {
    return video.thumbnailCacheUrl;
  }
  // Playlist ids (PL…) are not video ids, so the video thumbnail proxy would
  // 404 and fall through to a broken image. Use the real playlist art instead.
  if (isPlaylistCard(video)) {
    return video.thumbnailUrl || "";
  }
  if (video.id) {
    return `/api/thumbnails/${video.id}`;
  }
  return video.thumbnailUrl || "";
}

export function handleThumbnailError(
  event: React.SyntheticEvent<HTMLImageElement, Event>,
  videoId?: string
) {
  const img = event.currentTarget;
  const currentSrc = img.src || "";
  const id = videoId || currentSrc.match(/(?:\/api\/thumbnails(?:\/[^/]+)?\/|\/vi(?:_webp)?\/)([a-zA-Z0-9_-]+)/)?.[1];

  if (!id) {
    return;
  }

  if (currentSrc.includes("/api/thumbnails/")) {
    // A missing playlist id must not be guessed into a YouTube video URL; drop
    // the art rather than requesting an unrelated thumbnail.
    img.src = id.startsWith("PL") ? "" : `https://i.ytimg.com/vi/${id}/hq720.jpg`;
  } else if (currentSrc.includes("maxresdefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/hq720.jpg`;
  } else if (currentSrc.includes("hq720")) {
    img.src = `https://i.ytimg.com/vi/${id}/sddefault.jpg`;
  } else if (currentSrc.includes("sddefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } else if (currentSrc.includes("hqdefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  }
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

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatViewCount(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return "";
  }

  return `${compactCount.format(Math.round(value))} ${value === 1 ? "view" : "views"}`;
}

/**
 * The card meta line. YouTube shows age and view count there, never the
 * duration — the duration already sits on the artwork, so repeating it under
 * the title is the same number twice on one card.
 */
export function formatCardMeta(video: FeedVideo) {
  const published = video.publishedText
    ? video.publishedText
    : video.publishedAt
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(video.publishedAt)
      : "";

  return [formatViewCount(video.viewCount), published].filter(Boolean).join(" · ");
}

/** How far you got, as a percentage for the resume bar. 0 hides the bar. */
export function watchProgressPercent(video: FeedVideo) {
  const ratio = video.watchTimeRatio || 0;

  if (ratio <= 0.02) {
    return 0;
  }

  return Math.min(100, Math.round(ratio * 100));
}

/** Why Gretel put this card here, from the recommendation trail it came in on. */
export function cardReason(video: FeedVideo) {
  const parent = video.parent_title;

  if (!parent || parent === video.title) {
    return "";
  }

  return `from “${parent}”`;
}

export function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

const apiTokenKey = "gretel.apiToken.v1";
const supabaseAccessTokenKey = "gretel.supabaseAccessToken.v1";

export function getStoredApiToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");
    if (tokenFromUrl) {
      window.sessionStorage.setItem(apiTokenKey, tokenFromUrl);
      params.delete("token");
      const cleanSearch = params.toString() ? `?${params.toString()}` : "";
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch}`);
      } catch {
        // Ignore replaceState errors
      }
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
  let supabaseAccessToken = "";
  try {
    supabaseAccessToken = window.sessionStorage.getItem(supabaseAccessTokenKey) || "";
  } catch {}
  return {
    ...extraHeaders,
    ...(token ? { "x-gretel-token": token } : {}),
    ...(supabaseAccessToken ? { "x-supabase-access-token": supabaseAccessToken } : {})
  };
}
