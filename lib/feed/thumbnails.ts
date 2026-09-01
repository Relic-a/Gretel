import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { getDataDir } from "../data-dir";

const dataDir = getDataDir();
const thumbnailDir = path.join(dataDir, "thumbnails");
const PROBE_TIMEOUT_MS = 5000;
const MIN_VALID_IMAGE_BYTES = 1000;

export function getCachedThumbnailPath(profileIdOrVideoId: string, maybeVideoId?: string) {
  const videoId = maybeVideoId !== undefined ? maybeVideoId : profileIdOrVideoId;
  const thumbnailPath = path.resolve(
    thumbnailDir,
    `${cleanFilePart(videoId)}.jpg`
  );
  const thumbnailRoot = `${path.resolve(thumbnailDir)}${path.sep}`;

  if (!thumbnailPath.startsWith(thumbnailRoot) && thumbnailPath !== path.resolve(thumbnailDir)) {
    throw new Error("Invalid thumbnail cache path");
  }

  return thumbnailPath;
}

export function cleanFilePart(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return cleaned || "unknown";
}

function detectImageContentType(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 && // P
    buffer[2] === 0x4e && // N
    buffer[3] === 0x47 && // G
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  return "image/jpeg";
}

export async function getCachedThumbnail(videoId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const filePath = getCachedThumbnailPath(videoId);
    const stats = await fs.stat(filePath);

    if (!stats.isFile() || stats.size < MIN_VALID_IMAGE_BYTES) {
      return null;
    }

    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      contentType: detectImageContentType(buffer)
    };
  } catch {
    return null;
  }
}

export async function writeCachedThumbnail(videoId: string, buffer: Buffer): Promise<string> {
  const filePath = getCachedThumbnailPath(videoId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const tempPath = path.resolve(
    dir,
    `.${cleanFilePart(videoId)}.${crypto.randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
    return filePath;
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

export async function fetchRemoteThumbnail(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cleanUrl = url.trim();
  if (!cleanUrl) {
    return null;
  }

  const normalizedUrl = cleanUrl.startsWith("//") ? `https:${cleanUrl}` : cleanUrl;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        Accept: "image/webp,image/apng,image/jpeg,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < MIN_VALID_IMAGE_BYTES) {
      return null;
    }

    const rawContentType = response.headers.get("content-type") || "";
    const contentType = rawContentType.startsWith("image/")
      ? rawContentType.split(";")[0].trim()
      : detectImageContentType(buffer);

    return { buffer, contentType };
  } catch {
    return null;
  }
}

function isHighQualityUrl(url: string): boolean {
  if (!url) return false;
  return url.includes("maxresdefault") || url.includes("hq720") || url.includes("sddefault");
}

export async function probeAndFetchThumbnail(
  videoId: string,
  candidateUrl?: string,
  fallbackCandidates: string[] = []
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const candidate = candidateUrl ? candidateUrl.trim() : "";
  const triedUrls = new Set<string>();

  // If candidate is explicitly high-quality, try it first
  if (candidate && isHighQualityUrl(candidate)) {
    triedUrls.add(candidate);
    const fetched = await fetchRemoteThumbnail(candidate);
    if (fetched) {
      return fetched;
    }
  }

  // Probe known high-quality YouTube thumbnail variants in quality order
  const highQualityProbes = [
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hq720.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/sddefault.jpg`
  ];

  for (const probeUrl of highQualityProbes) {
    if (triedUrls.has(probeUrl)) {
      continue;
    }
    triedUrls.add(probeUrl);

    const fetched = await fetchRemoteThumbnail(probeUrl);
    if (fetched) {
      return fetched;
    }
  }

  // Fallback to candidate URL (the best real static candidate supplied)
  if (candidate && !triedUrls.has(candidate)) {
    triedUrls.add(candidate);
    const fetched = await fetchRemoteThumbnail(candidate);
    if (fetched) {
      return fetched;
    }
  }

  // Additional fallback candidates if provided
  for (const fallbackUrl of fallbackCandidates) {
    const trimmed = fallbackUrl.trim();
    if (!trimmed || triedUrls.has(trimmed)) {
      continue;
    }
    triedUrls.add(trimmed);

    const fetched = await fetchRemoteThumbnail(trimmed);
    if (fetched) {
      return fetched;
    }
  }

  // Standard lower-resolution fallbacks
  const standardFallbacks = [
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/default.jpg`
  ];

  for (const fallbackUrl of standardFallbacks) {
    if (triedUrls.has(fallbackUrl)) {
      continue;
    }
    triedUrls.add(fallbackUrl);

    const fetched = await fetchRemoteThumbnail(fallbackUrl);
    if (fetched) {
      return fetched;
    }
  }

  return null;
}

export type ThumbnailResult = {
  buffer: Buffer;
  contentType: string;
  fromCache: boolean;
};

export async function getOrFetchThumbnail(
  videoId: string,
  candidateUrl?: string,
  fallbackCandidates: string[] = []
): Promise<ThumbnailResult | null> {
  const cached = await getCachedThumbnail(videoId);
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: cached.contentType,
      fromCache: true
    };
  }

  const inFlightCache = getGlobalInFlightThumbnailFetches();
  const existingFetch = inFlightCache.get(videoId);

  if (existingFetch) {
    const result = await existingFetch;
    return result ? { buffer: result.buffer, contentType: result.contentType, fromCache: false } : null;
  }

  const fetchPromise = (async () => {
    try {
      const fetched = await probeAndFetchThumbnail(videoId, candidateUrl, fallbackCandidates);
      if (fetched) {
        await writeCachedThumbnail(videoId, fetched.buffer);
        return fetched;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightCache.delete(videoId);
    }
  })();

  inFlightCache.set(videoId, fetchPromise);
  const result = await fetchPromise;

  if (result) {
    return {
      buffer: result.buffer,
      contentType: result.contentType,
      fromCache: false
    };
  }

  return null;
}

function getGlobalInFlightThumbnailFetches(): Map<string, Promise<{ buffer: Buffer; contentType: string } | null>> {
  const globalKey = "__gretelInFlightThumbnailFetches";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, Promise<{ buffer: Buffer; contentType: string } | null>>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, Promise<{ buffer: Buffer; contentType: string } | null>>();
  }

  return globalScope[globalKey];
}

export function clearThumbnailMemoryCache() {
  getGlobalInFlightThumbnailFetches().clear();
}
