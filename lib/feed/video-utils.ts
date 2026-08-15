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

export function getThumbnailUrl(video: unknown) {
  const direct = getThumbnailFromValue(video);

  if (direct) {
    return direct;
  }

  if (video && typeof video === "object" && "content_image" in video) {
    return getThumbnailFromValue(video.content_image);
  }

  if (video && typeof video === "object" && "metadata" in video) {
    return getThumbnailFromValue(video.metadata);
  }

  return "";
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

function getThumbnailFromValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(getThumbnailFromValue).filter(Boolean).at(-1) || "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const source = value as Record<string, unknown>;

  for (const key of ["avatar", "thumbnails", "thumbnail", "image", "author"] as const) {
    if (!(key in source)) {
      continue;
    }

    const candidate = source[key];
    const thumbnail = Array.isArray(candidate)
      ? candidate.map(getThumbnailFromValue).filter(Boolean).at(-1) || ""
      : getThumbnailFromValue(candidate);

    if (thumbnail) {
      return normalizeThumbnailUrl(thumbnail);
    }
  }

  if ("url" in value) {
    return normalizeThumbnailUrl(getText(source.url));
  }

  return "";
}

export function getChannelAvatarUrl(channel: unknown): string | undefined {
  if (!channel || typeof channel !== "object") {
    return undefined;
  }

  const source = channel as Record<string, unknown>;
  const metadata = source.metadata;

  if (metadata && typeof metadata === "object" && "avatar" in metadata) {
    return getThumbnailFromValue((metadata as Record<string, unknown>).avatar) || undefined;
  }

  if ("avatar" in source) {
    return getThumbnailFromValue(source.avatar) || undefined;
  }

  return getThumbnailUrl(channel) || undefined;
}

export function getAuthorAvatarUrl(video: unknown): string | undefined {
  if (!video || typeof video !== "object") {
    return undefined;
  }

  const author = "author" in video ? (video as Record<string, unknown>).author : undefined;

  if (!author || typeof author !== "object") {
    return undefined;
  }

  if (!("thumbnails" in author)) {
    return undefined;
  }

  const thumbnails = (author as Record<string, unknown>).thumbnails;

  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return undefined;
  }

  for (const thumb of thumbnails) {
    if (thumb && typeof thumb === "object" && "url" in thumb) {
      const url = getText((thumb as Record<string, unknown>).url);
      if (url) {
        return normalizeThumbnailUrl(url);
      }
    }
  }

  return undefined;
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
