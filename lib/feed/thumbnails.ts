import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

export function getCachedThumbnailPath(profileId: string, videoId: string) {
  return path.join(dataDir, "thumbnails", cleanFilePart(profileId), `${cleanFilePart(videoId)}.jpg`);
}

function cleanFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
