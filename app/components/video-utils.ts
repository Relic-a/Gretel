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
    supabaseAccessToken = window.localStorage.getItem(supabaseAccessTokenKey) || "";
  } catch {}
  return {
    ...extraHeaders,
    ...(token ? { "x-gretel-token": token } : {}),
    ...(supabaseAccessToken ? { "x-supabase-access-token": supabaseAccessToken } : {})
  };
}
