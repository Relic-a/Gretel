import { getYoutubeClient } from "./youtube-client";
import type { GretelConfig } from "./config-defaults";
import type { FeedVideo } from "./types";
import { getText } from "./video-utils";

export async function fetchTranscriptIntroduction(
  profileId: string,
  videoId: string,
  config: GretelConfig
) {
  if (config.transcription.introductionPercentage <= 0 || config.transcription.maxCharacters <= 0) {
    return "";
  }

  try {
    const youtube = await getYoutubeClient(profileId);
    const info = await youtube.getInfo(videoId);
    const getTranscript = (info as { getTranscript?: () => Promise<unknown> }).getTranscript;

    if (typeof getTranscript !== "function") {
      return "";
    }

    const transcript = await getTranscript.call(info);
    const segments = transcriptSegments(transcript);
    const fullText = segments.map(getText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

    if (!fullText) {
      return "";
    }

    const percentageLength = Math.ceil(fullText.length * config.transcription.introductionPercentage);
    const introductionLength = Math.min(percentageLength, config.transcription.maxCharacters);

    return fullText.slice(0, introductionLength).trim();
  } catch {
    return "";
  }
}

export function createEmbeddingInputWithTranscript(video: FeedVideo, transcriptIntroduction: string) {
  return [video.title, video.author, video.query, transcriptIntroduction].filter(Boolean).join("\n");
}

function transcriptSegments(transcript: unknown) {
  if (!transcript || typeof transcript !== "object" || !("transcript" in transcript)) {
    return [];
  }

  const root = transcript.transcript;

  if (!root || typeof root !== "object" || !("content" in root)) {
    return [];
  }

  const content = root.content;

  if (!content || typeof content !== "object" || !("body" in content)) {
    return [];
  }

  const body = content.body;

  if (!body || typeof body !== "object" || !("initial_segments" in body)) {
    return [];
  }

  const initialSegments = body.initial_segments;

  if (!Array.isArray(initialSegments)) {
    return [];
  }

  return initialSegments.flatMap((segment) => {
    if (!segment || typeof segment !== "object" || !("snippet" in segment)) {
      return [];
    }

    return [segment.snippet];
  });
}
