export type YouTubePlayerErrorKind =
  | "invalid_parameter"
  | "html5_playback"
  | "video_unavailable"
  | "embedding_disabled"
  | "client_identity_missing"
  | "unknown";

export type YouTubePlayerErrorInfo = {
  code: number;
  kind: YouTubePlayerErrorKind;
  title: string;
  message: string;
};

/**
 * Keep this mapping aligned with the YouTube IFrame Player API onError codes.
 * Code 5 is intentionally broad: YouTube documents it as an HTML5 playback
 * error, which can have causes other than missing media codecs.
 */
export function describeYouTubePlayerError(code: number): YouTubePlayerErrorInfo {
  switch (code) {
    case 2:
      return {
        code,
        kind: "invalid_parameter",
        title: "YouTube rejected this video request",
        message: "The player received an invalid video ID or another invalid parameter."
      };
    case 5:
      return {
        code,
        kind: "html5_playback",
        title: "This video could not play here",
        message: "YouTube's HTML5 player reported a playback error. Browser media support, the network, or this video's format may be involved."
      };
    case 100:
      return {
        code,
        kind: "video_unavailable",
        title: "This video is unavailable",
        message: "The video was removed, made private, or could not be found."
      };
    case 101:
    case 150:
      return {
        code,
        kind: "embedding_disabled",
        title: "Watch this video on YouTube",
        message: "The video owner does not allow playback in embedded players."
      };
    case 153:
      return {
        code,
        kind: "client_identity_missing",
        title: "YouTube could not verify this player",
        message: "The request did not include the client identity information YouTube requires."
      };
    default:
      return {
        code,
        kind: "unknown",
        title: "YouTube playback failed",
        message: "The embedded player reported an unexpected error."
      };
  }
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
