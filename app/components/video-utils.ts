import type React from "react";
import type { FeedVideo } from "../types";

export function thumbnailFor(video: FeedVideo) {
  return video.thumbnailUrl || (video.id ? `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg` : "");
}

export function handleThumbnailError(
  event: React.SyntheticEvent<HTMLImageElement, Event>,
  videoId?: string
) {
  const img = event.currentTarget;
  const currentSrc = img.src || "";
  const id = videoId || currentSrc.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]+)\//)?.[1];

  if (!id) {
    return;
  }

  if (currentSrc.includes("maxresdefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/hq720.jpg`;
  } else if (currentSrc.includes("hq720")) {
    img.src = `https://i.ytimg.com/vi/${id}/sddefault.jpg`;
  } else if (currentSrc.includes("sddefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } else if (currentSrc.includes("hqdefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  } else if (!currentSrc.includes("mqdefault")) {
    img.src = `https://i.ytimg.com/vi/${id}/hq720.jpg`;
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
  return {
    ...extraHeaders,
    ...(token ? { "x-gretel-token": token } : {})
  };
}
