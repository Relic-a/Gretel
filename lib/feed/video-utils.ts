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

export function mixVideoBuckets(videoBuckets: FeedVideo[][]) {
  const maxVideos = getGretelConfig().feed.maxVideos;
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
  const count = Number(text.replace(/[^\d]/g, ""));

  return Number.isFinite(count) ? count : 0;
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
