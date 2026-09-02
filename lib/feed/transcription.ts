import { fetchYoutubeTranscript } from "./youtube-client";
import type { GretelConfig } from "./config-defaults";
import type { FeedVideo } from "./types";

let activeTranscriptRequests = 0;
const transcriptWaiters: Array<() => void> = [];
const maxConcurrentTranscripts = 24;

const rawTranscriptCache = new Map<string, string>();
const inFlightTranscripts = new Map<string, Promise<string>>();
const maxCacheSize = 2000;

function rememberRawTranscript(key: string, text: string) {
  if (rawTranscriptCache.size >= maxCacheSize) {
    const oldestKey = rawTranscriptCache.keys().next().value;
    if (oldestKey) {
      rawTranscriptCache.delete(oldestKey);
    }
  }
  rawTranscriptCache.set(key, text);
}

async function acquireTranscriptSlot(): Promise<() => void> {
  if (activeTranscriptRequests < maxConcurrentTranscripts) {
    activeTranscriptRequests += 1;
    return releaseTranscriptSlot;
  }

  return new Promise((resolve) => {
    transcriptWaiters.push(() => {
      activeTranscriptRequests += 1;
      resolve(releaseTranscriptSlot);
    });
  });
}

function releaseTranscriptSlot() {
  activeTranscriptRequests -= 1;
  const next = transcriptWaiters.shift();
  if (next) {
    next();
  }
}

function isNonRetryableTranscriptError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("disabled") ||
    msg.includes("not available") ||
    msg.includes("could not find") ||
    msg.includes("unavailable") ||
    msg.includes("no transcript") ||
    msg.includes("404") ||
    msg.includes("status: 400") ||
    msg.includes("status: 404") ||
    msg.includes("disabledvideoerror") ||
    msg.includes("notranscriptavailableerror")
  );
}

async function fetchTranscriptWithRetry(
  videoId: string,
  language: string,
  timeoutMs = 1800,
  maxRetries = 0
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const fetchPromise = fetchYoutubeTranscript(videoId, language);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Transcript fetch timed out")), timeoutMs);
      });

      try {
        return await Promise.race([fetchPromise, timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      if (isNonRetryableTranscriptError(error) || attempt === maxRetries) {
        return "";
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }

  return "";
}

export async function fetchTranscriptIntroduction(
  _profileId: string,
  videoId: string,
  config: GretelConfig
) {
  if (
    !videoId ||
    config.transcription.introductionPercentage <= 0 ||
    config.transcription.maxCharacters <= 0
  ) {
    return "";
  }

  const cacheKey = `${videoId}:${config.youtube.language || "en"}`;
  const cachedRaw = rawTranscriptCache.get(cacheKey);

  if (cachedRaw !== undefined) {
    return formatIntroduction(cachedRaw, config);
  }

  const existingRequest = inFlightTranscripts.get(cacheKey);
  if (existingRequest) {
    const rawText = await existingRequest;
    return formatIntroduction(rawText, config);
  }

  const request = (async () => {
    const release = await acquireTranscriptSlot();
    try {
      const rawText = await fetchTranscriptWithRetry(videoId, config.youtube.language, 1800, 0);
      const cleaned = (rawText || "").replace(/\s+/g, " ").trim();
      rememberRawTranscript(cacheKey, cleaned);
      return cleaned;
    } catch {
      rememberRawTranscript(cacheKey, "");
      return "";
    } finally {
      release();
    }
  })();

  inFlightTranscripts.set(cacheKey, request);

  try {
    const rawText = await request;
    return formatIntroduction(rawText, config);
  } finally {
    inFlightTranscripts.delete(cacheKey);
  }
}

export function getCachedTranscriptIntroduction(videoId: string, config: GretelConfig): string {
  if (
    !videoId ||
    config.transcription.introductionPercentage <= 0 ||
    config.transcription.maxCharacters <= 0
  ) {
    return "";
  }

  const cacheKey = `${videoId}:${config.youtube.language || "en"}`;
  const cachedRaw = rawTranscriptCache.get(cacheKey);

  if (cachedRaw !== undefined) {
    return formatIntroduction(cachedRaw, config);
  }

  return "";
}

function formatIntroduction(fullText: string, config: GretelConfig): string {
  if (!fullText) {
    return "";
  }

  const percentageLength = Math.ceil(fullText.length * config.transcription.introductionPercentage);
  const introductionLength = Math.min(percentageLength, config.transcription.maxCharacters);

  return fullText.slice(0, introductionLength).trim();
}

export function createEmbeddingInputWithTranscript(video: FeedVideo, transcriptIntroduction: string) {
  return [video.title, video.author, video.query, transcriptIntroduction].filter(Boolean).join("\n");
}

