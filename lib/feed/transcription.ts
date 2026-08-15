import { fetchYoutubeTranscript } from "./youtube-client";
import type { GretelConfig } from "./config-defaults";
import type { FeedVideo } from "./types";

export async function fetchTranscriptIntroduction(
  _profileId: string,
  videoId: string,
  config: GretelConfig
) {
  if (config.transcription.introductionPercentage <= 0 || config.transcription.maxCharacters <= 0) {
    return "";
  }

  try {
    const fullText = (await fetchYoutubeTranscript(videoId, config.youtube.language))
      .replace(/\s+/g, " ")
      .trim();

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
