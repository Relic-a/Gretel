import { fetchYoutubeTranscript } from "./youtube-client";
import type { GretelConfig } from "./config-defaults";
import type { FeedVideo } from "./types";

let activeTranscriptRequests = 0;
const transcriptWaiters: Array<() => void> = [];
const maxConcurrentTranscripts = 3;

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

async function fetchTranscriptWithRetry(
  videoId: string,
  language: string,
  timeoutMs = 5000,
  maxRetries = 2
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
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt)));
    }
  }

  return "";
}

export async function fetchTranscriptIntroduction(
  _profileId: string,
  videoId: string,
  config: GretelConfig
) {
  if (config.transcription.introductionPercentage <= 0 || config.transcription.maxCharacters <= 0) {
    return "";
  }

  const release = await acquireTranscriptSlot();

  try {
    const rawText = await fetchTranscriptWithRetry(videoId, config.youtube.language, 5000, 2);
    const fullText = rawText.replace(/\s+/g, " ").trim();

    if (!fullText) {
      return "";
    }

    const percentageLength = Math.ceil(fullText.length * config.transcription.introductionPercentage);
    const introductionLength = Math.min(percentageLength, config.transcription.maxCharacters);

    return fullText.slice(0, introductionLength).trim();
  } catch {
    return "";
  } finally {
    release();
  }
}

export function createEmbeddingInputWithTranscript(video: FeedVideo, transcriptIntroduction: string) {
  return [video.title, video.author, video.query, transcriptIntroduction].filter(Boolean).join("\n");
}
