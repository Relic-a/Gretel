import path from "node:path";

import { getDataDir } from "../data-dir";

const dataDir = getDataDir();
const thumbnailDir = path.join(dataDir, "thumbnails");

export function getCachedThumbnailPath(profileId: string, videoId: string) {
  const thumbnailPath = path.resolve(
    thumbnailDir,
    cleanFilePart(profileId),
    `${cleanFilePart(videoId)}.jpg`
  );
  const thumbnailRoot = `${path.resolve(thumbnailDir)}${path.sep}`;

  if (!thumbnailPath.startsWith(thumbnailRoot)) {
    throw new Error("Invalid thumbnail cache path");
  }

  return thumbnailPath;
}

function cleanFilePart(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return cleaned || "unknown";
}
