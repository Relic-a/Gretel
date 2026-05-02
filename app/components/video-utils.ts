import type { FeedVideo } from "../types";

export function thumbnailFor(video: FeedVideo) {
  return video.thumbnailCacheUrl || video.thumbnailUrl || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
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
