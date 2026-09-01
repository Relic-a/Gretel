import { getGretelConfig } from "./config";
import type { FeedVideo } from "./types";

export function shouldKeepVideo(id: string, seen: Set<string>) {
  return Boolean(id) && !seen.has(id);
}

export function nextUniqueVideo(videos: FeedVideo[], seen: Set<string>, startIndex: number) {
  for (let index = startIndex; index < videos.length; index += 1) {
    const video = videos[index];

    if (!seen.has(video.id)) {
      seen.add(video.id);
      return { item: video, nextIndex: index + 1 };
    }
  }

  return { item: null, nextIndex: videos.length };
}

export function mixVideoBuckets(videoBuckets: FeedVideo[][], maxVideos = getGretelConfig().feed.maxVideos) {
  const mixed: FeedVideo[] = [];

  for (let index = 0; mixed.length < maxVideos; index += 1) {
    let added = false;

    for (const videos of videoBuckets) {
      const video = videos[index];

      if (video) {
        mixed.push(video);
        added = true;
      }

      if (mixed.length >= maxVideos) {
        break;
      }
    }

    if (!added) {
      break;
    }
  }

  return mixed;
}

export function getVideoIdFromLink(link: string) {
  try {
    const url = new URL(link);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }

    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

export function getVideoId(video: unknown) {
  if (!video || typeof video !== "object") {
    return "";
  }

  if ("content_id" in video) {
    return getText(video.content_id);
  }

  if ("video_id" in video) {
    return getText(video.video_id);
  }

  if ("id" in video) {
    return getText(video.id);
  }

  return "";
}

export function getTitle(video: unknown) {
  if (!video || typeof video !== "object") {
    return "Untitled video";
  }

  if ("metadata" in video) {
    const metadata = video.metadata;

    if (metadata && typeof metadata === "object" && "title" in metadata) {
      return getText(metadata.title) || "Untitled video";
    }
  }

  if ("title" in video) {
    return getText(video.title) || "Untitled video";
  }

  if ("overlay_metadata" in video) {
    const metadata = video.overlay_metadata;

    if (metadata && typeof metadata === "object" && "primary_text" in metadata) {
      return getText(metadata.primary_text) || "Untitled video";
    }
  }

  return "Untitled video";
}

export function getAuthor(video: unknown) {
  if (!video || typeof video !== "object") {
    return "Unknown channel";
  }

  if ("metadata" in video) {
    const metadata = video.metadata;

    if (metadata && typeof metadata === "object" && "image" in metadata) {
      const image = metadata.image;

      if (image && typeof image === "object" && "a11y_label" in image) {
        const label = getText(image.a11y_label).replace(/^Go to channel\s+/i, "").trim();

        if (label) {
          return label;
        }
      }
    }

    const rowAuthor = getAuthorFromMetadataRows(metadata);

    if (rowAuthor) {
      return rowAuthor;
    }
  }

  const author = "author" in video ? video.author : undefined;

  if (author && typeof author === "object" && "name" in author) {
    return getText(author.name) || "Unknown channel";
  }

  return "Unknown channel";
}

export function getChannelVideoAuthor(video: unknown, channelName: string) {
  const author = getAuthor(video);

  if (!author || author === "N/A" || author === "Unknown channel") {
    return channelName;
  }

  return author;
}

export function getDuration(video: unknown) {
  if (!video || typeof video !== "object") {
    return "";
  }

  if ("content_image" in video) {
    const duration = getDurationFromThumbnail(video.content_image);

    if (duration) {
      return duration;
    }
  }

  if ("duration" in video) {
    const duration = video.duration;

    if (duration && typeof duration === "object" && "text" in duration) {
      return getText(duration.text);
    }
  }

  if ("length_text" in video) {
    return getText(video.length_text);
  }

  return "";
}

export function getViewCount(video: unknown) {
  if (!video || typeof video !== "object" || !("view_count" in video)) {
    return 0;
  }

  const text = getText(video.view_count);
  const match = text.match(/([\d,.]+)\s*([kmb])?/i);

  if (!match) {
    return 0;
  }

  const count = Number(match[1].replace(/,/g, ""));
  const suffix = (match[2] || "").toLowerCase();
  const multiplier = suffix === "b" ? 1_000_000_000 : suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;

  return Number.isFinite(count) ? count * multiplier : 0;
}

export function getPublishedText(video: unknown) {
  if (video && typeof video === "object" && "published" in video) {
    const published = getText(video.published);

    if (published) {
      return published;
    }
  }

  const texts = getMetadataTexts(video);
  return texts.find((text) => /\bago\b|premiered|streamed|published/i.test(text)) || "";
}

export function getPublishedAt(video: unknown) {
  const text = getPublishedText(video);
  const match = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const day = 24 * 60 * 60 * 1000;
  const multipliers: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day,
    week: 7 * day,
    month: 30 * day,
    year: 365 * day
  };

  return Date.now() - amount * multipliers[unit];
}

function getAuthorFromMetadataRows(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("metadata" in metadata)) {
    return "";
  }

  const contentMetadata = metadata.metadata;

  if (
    !contentMetadata ||
    typeof contentMetadata !== "object" ||
    !("metadata_rows" in contentMetadata) ||
    !Array.isArray(contentMetadata.metadata_rows)
  ) {
    return "";
  }

  for (const row of contentMetadata.metadata_rows) {
    if (!row || typeof row !== "object" || !("metadata_parts" in row) || !Array.isArray(row.metadata_parts)) {
      continue;
    }

    for (const part of row.metadata_parts) {
      if (!part || typeof part !== "object" || !("text" in part)) {
        continue;
      }

      const text = getText(part.text);

      if (text && !/\bviews?\b|ago$|watching/i.test(text)) {
        return text;
      }
    }
  }

  return "";
}

function getMetadataTexts(video: unknown) {
  const metadata = video && typeof video === "object" && "metadata" in video ? video.metadata : video;

  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("metadata" in metadata) ||
    !metadata.metadata ||
    typeof metadata.metadata !== "object" ||
    !("metadata_rows" in metadata.metadata) ||
    !Array.isArray(metadata.metadata.metadata_rows)
  ) {
    return [];
  }

  return metadata.metadata.metadata_rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || !("metadata_parts" in row) || !Array.isArray(row.metadata_parts)) {
      return [];
    }

    return row.metadata_parts.flatMap((part: unknown) => {
      if (!part || typeof part !== "object" || !("text" in part)) {
        return [];
      }

      const text = getText(part.text);
      return text ? [text] : [];
    });
  });
}

export type ThumbnailCandidate = {
  url: string;
  width?: number;
  height?: number;
};

export const QUALITY_FLOOR_WIDTH = 700;

export function estimateThumbnailWidth(candidate: ThumbnailCandidate): number {
  const rawUrl = candidate.url;
  if (!rawUrl) {
    return 0;
  }

  if (rawUrl.includes("an_webp") || rawUrl.includes("mqdefault_6s.webp") || rawUrl.includes("_6s.webp")) {
    return 0;
  }

  const width = typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0;
  const height = typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0;

  if (width > 0) {
    return width;
  }

  if (height > 0) {
    return Math.round((height * 16) / 9);
  }

  if (rawUrl.includes("maxresdefault")) return 1920;
  if (rawUrl.includes("hq720")) return 1280;
  if (rawUrl.includes("sddefault")) return 640;
  if (rawUrl.includes("hqdefault")) return 480;
  if (rawUrl.includes("mqdefault")) return 320;
  if (rawUrl.includes("default.jpg") || rawUrl.endsWith("/default.jpg")) return 120;

  const wMatch = rawUrl.match(/[=/-]w(\d+)/);
  if (wMatch) {
    const w = parseInt(wMatch[1], 10);
    if (!Number.isNaN(w) && w > 0) {
      return w;
    }
  }

  const sMatch = rawUrl.match(/=s(\d+)/);
  if (sMatch) {
    const s = parseInt(sMatch[1], 10);
    if (!Number.isNaN(s) && s > 0) {
      return s;
    }
  }

  return 0;
}

export function collectThumbnailCandidates(value: unknown, collected: ThumbnailCandidate[] = []): ThumbnailCandidate[] {
  if (!value) {
    return collected;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectThumbnailCandidates(item, collected);
    }
    return collected;
  }

  if (typeof value === "string") {
    if (value.trim()) {
      collected.push({ url: value.trim() });
    }
    return collected;
  }

  if (typeof value !== "object") {
    return collected;
  }

  const source = value as Record<string, unknown>;

  if ("url" in source && typeof source.url === "string" && source.url.trim()) {
    collected.push({
      url: source.url.trim(),
      width: typeof source.width === "number" && Number.isFinite(source.width) ? source.width : undefined,
      height: typeof source.height === "number" && Number.isFinite(source.height) ? source.height : undefined
    });
  }

  for (const key of ["thumbnails", "thumbnail", "image", "avatar", "content_image", "metadata"] as const) {
    if (key in source && source[key]) {
      collectThumbnailCandidates(source[key], collected);
    }
  }

  return collected;
}

export type CandidateSelectionResult = {
  selectedUrl: string;
  meetsQualityFloor: boolean;
  width: number;
  fallbackCandidates: string[];
};

export function selectThumbnailCandidate(candidates: ThumbnailCandidate[]): CandidateSelectionResult {
  const validCandidates = candidates.filter((c) => {
    if (!c || typeof c !== "object" || !c.url || typeof c.url !== "string") {
      return false;
    }
    const trimmed = c.url.trim();
    if (!trimmed) return false;
    if (trimmed.includes("an_webp") || trimmed.includes("mqdefault_6s.webp") || trimmed.includes("_6s.webp")) {
      return false;
    }
    return true;
  });

  if (validCandidates.length === 0) {
    return {
      selectedUrl: "",
      meetsQualityFloor: false,
      width: 0,
      fallbackCandidates: []
    };
  }

  const evaluated = validCandidates.map((c) => ({
    url: normalizeThumbnailUrl(c.url.trim()),
    width: estimateThumbnailWidth(c),
    height: c.height
  }));

  const nonTiny = evaluated.filter((c) => c.width >= 300 || c.width === 0);
  const pool = nonTiny.length > 0 ? nonTiny : evaluated;

  const highQuality = pool.filter((c) => c.width >= QUALITY_FLOOR_WIDTH);

  if (highQuality.length > 0) {
    highQuality.sort((a, b) => a.width - b.width);
    const chosen = highQuality[0];
    return {
      selectedUrl: chosen.url,
      meetsQualityFloor: true,
      width: chosen.width,
      fallbackCandidates: []
    };
  }

  pool.sort((a, b) => b.width - a.width);
  const bestFallback = pool[0];
  const fallbackCandidates = [...new Set(pool.map((c) => c.url))];

  return {
    selectedUrl: bestFallback ? bestFallback.url : "",
    meetsQualityFloor: false,
    width: bestFallback ? bestFallback.width : 0,
    fallbackCandidates
  };
}

export function getThumbnailUrl(video: unknown, explicitId?: string): string {
  const id = explicitId || getVideoId(video);
  const candidates = collectThumbnailCandidates(video);
  const selection = selectThumbnailCandidate(candidates);

  if (selection.selectedUrl) {
    return selection.selectedUrl;
  }

  if (id) {
    return `https://i.ytimg.com/vi/${id}/hq720.jpg`;
  }

  return "";
}

function getAvatarUrlFromValue(value: unknown): string {
  const candidates = collectThumbnailCandidates(value);
  const valid = candidates.filter((c) => {
    if (!c || !c.url || typeof c.url !== "string") return false;
    const trimmed = c.url.trim();
    return Boolean(trimmed && !trimmed.includes("an_webp") && !trimmed.includes("_6s.webp"));
  });

  if (valid.length === 0) {
    return "";
  }

  let best = valid[0];
  let bestSize = estimateThumbnailWidth(best);

  for (let i = 1; i < valid.length; i += 1) {
    const candidate = valid[i];
    const size = estimateThumbnailWidth(candidate);
    if (size > bestSize) {
      best = candidate;
      bestSize = size;
    }
  }

  return normalizeThumbnailUrl(best.url);
}

export function getChannelAvatarUrl(channel: unknown): string | undefined {
  if (!channel || typeof channel !== "object") {
    return undefined;
  }

  const source = channel as Record<string, unknown>;

  if ("author" in source && source.author && typeof source.author === "object") {
    const authorThumb = getAuthorAvatarUrl(source);
    if (authorThumb) {
      return authorThumb;
    }
  }

  const metadata = source.metadata;
  if (metadata && typeof metadata === "object" && "avatar" in metadata) {
    const thumb = getAvatarUrlFromValue((metadata as Record<string, unknown>).avatar);
    if (thumb) {
      return thumb;
    }
  }

  const header = source.header;
  if (header && typeof header === "object") {
    const headerSource = header as Record<string, unknown>;
    if ("author" in headerSource && headerSource.author && typeof headerSource.author === "object") {
      const thumb = getAuthorAvatarUrl(headerSource);
      if (thumb) {
        return thumb;
      }
    }
    if ("avatar" in headerSource && headerSource.avatar) {
      const thumb = getAvatarUrlFromValue(headerSource.avatar);
      if (thumb) {
        return thumb;
      }
    }
    if ("thumbnails" in headerSource && headerSource.thumbnails) {
      const thumb = getAvatarUrlFromValue(headerSource.thumbnails);
      if (thumb) {
        return thumb;
      }
    }
  }

  if ("avatar" in source && source.avatar) {
    const thumb = getAvatarUrlFromValue(source.avatar);
    if (thumb) {
      return thumb;
    }
  }

  if ("thumbnails" in source && source.thumbnails) {
    const thumb = getAvatarUrlFromValue(source.thumbnails);
    if (thumb) {
      return thumb;
    }
  }

  if ("thumbnail" in source && source.thumbnail) {
    const thumb = getAvatarUrlFromValue(source.thumbnail);
    if (thumb) {
      return thumb;
    }
  }

  const directThumb = getAvatarUrlFromValue(source);
  return directThumb || undefined;
}

export function getAuthorAvatarUrl(video: unknown): string | undefined {
  if (!video || typeof video !== "object") {
    return undefined;
  }

  const author = "author" in video ? (video as Record<string, unknown>).author : undefined;

  if (!author || typeof author !== "object") {
    return undefined;
  }

  const source = author as Record<string, unknown>;

  if ("thumbnails" in source && source.thumbnails) {
    const thumb = getAvatarUrlFromValue(source.thumbnails);
    if (thumb) {
      return thumb;
    }
  }

  if ("avatar" in source && source.avatar) {
    const thumb = getAvatarUrlFromValue(source.avatar);
    if (thumb) {
      return thumb;
    }
  }

  const fallback = getAvatarUrlFromValue(author);
  return fallback || undefined;
}

export function getAuthorChannelId(video: unknown): string | undefined {
  if (!video || typeof video !== "object") {
    return undefined;
  }

  const videoSource = video as Record<string, unknown>;
  const videoChannelId = getText(videoSource.channel_id) ||
    getText(videoSource.channelId) ||
    getText(videoSource.author_id);

  if (videoChannelId && videoChannelId !== "N/A") {
    return videoChannelId;
  }

  const author = videoSource.author;

  if (!author || typeof author !== "object") {
    return undefined;
  }

  const source = author as Record<string, unknown>;
  const directId = getText(source.id) || getText(source.channel_id);

  if (directId && directId !== "N/A") {
    return directId;
  }

  const endpoint = source.endpoint;

  if (endpoint && typeof endpoint === "object" && "payload" in endpoint) {
    const payload = (endpoint as Record<string, unknown>).payload;

    if (payload && typeof payload === "object" && "browseId" in payload) {
      const browseId = getText((payload as Record<string, unknown>).browseId);
      return browseId && browseId !== "N/A" ? browseId : undefined;
    }
  }

  return undefined;
}

function normalizeThumbnailUrl(url: string) {
  return url.startsWith("//") ? `https:${url}` : url;
}

function getDurationFromThumbnail(contentImage: unknown) {
  if (!contentImage || typeof contentImage !== "object" || !("overlays" in contentImage)) {
    return "";
  }

  const overlays = contentImage.overlays;

  if (!Array.isArray(overlays)) {
    return "";
  }

  for (const overlay of overlays) {
    if (!overlay || typeof overlay !== "object" || !("badges" in overlay) || !Array.isArray(overlay.badges)) {
      continue;
    }

    for (const badge of overlay.badges) {
      if (!badge || typeof badge !== "object" || !("text" in badge)) {
        continue;
      }

      const text = getText(badge.text);

      if (/^\d+(?::\d+)+$/.test(text)) {
        return text;
      }
    }
  }

  return "";
}

export function getText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if ("text" in value) {
    return getText(value.text);
  }

  if ("toString" in value && typeof value.toString === "function") {
    const text = value.toString();
    return text === "[object Object]" ? "" : text;
  }

  return "";
}
