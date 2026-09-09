import type { FeedVideo } from "../types";

export type CardFeedbackAction = "notInterested" | "hideVideo" | "muteChannel";

export type FeedbackSnapshot = {
  notInterestedVideoIds: string[];
  hiddenVideoIds: string[];
  mutedChannelIds: string[];
  mutedChannelKeys: string[];
};

export function normalizeChannelKey(value: string | undefined) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function channelMatchesVideo(video: FeedVideo, target: FeedVideo) {
  if (target.channelId && video.channelId && video.channelId === target.channelId) {
    return true;
  }

  const left = normalizeChannelKey(video.channelKey || video.author);
  const right = normalizeChannelKey(target.channelKey || target.author);
  return Boolean(left && left === right);
}

export function feedbackTargetIds(
  action: CardFeedbackAction,
  target: FeedVideo,
  videos: FeedVideo[]
) {
  if (action === "muteChannel") {
    return videos.filter((video) => channelMatchesVideo(video, target)).map((video) => video.id);
  }

  return videos.some((video) => video.id === target.id) ? [target.id] : [];
}

export function buildFeedbackPayload(profileId: string, action: CardFeedbackAction, video: FeedVideo) {
  return {
    profileId,
    action,
    videoId: video.id,
    channelId: video.channelId || undefined,
    channelKey: video.channelKey || undefined,
    channelName: video.author || undefined,
    video
  };
}

export function feedbackScopeDescription(action: CardFeedbackAction, channelName?: string) {
  if (action === "muteChannel") {
    return `Hides every current and future video from ${channelName || "this channel"} in Home, search, Up next, and fresh builds. Saved videos and watch history are kept.`;
  }
  if (action === "hideVideo") {
    return "Removes this video from Home, search, and Up next right away. Saved videos and history are kept.";
  }
  return "Shows fewer videos like this across Home, search, and Up next. Saved videos and history are kept.";
}

export function feedbackToastCopy(
  action: CardFeedbackAction,
  video: FeedVideo,
  removedCount: number
) {
  if (action === "muteChannel") {
    return {
      title: `Muted ${video.author || "this channel"}`,
      detail:
        removedCount > 0
          ? `Removed ${removedCount} ${removedCount === 1 ? "video" : "videos"} from this view. Future Home, search, and Up next results skip this channel.`
          : "Future Home, search, and Up next results skip this channel."
    };
  }
  if (action === "hideVideo") {
    return {
      title: "Video hidden",
      detail: `Removed “${video.title}” from this view. Saved videos and history are kept.`
    };
  }
  return {
    title: "Got it — fewer like this",
    detail: `Removed “${video.title}” and tuned future recommendations. Saved videos and history are kept.`
  };
}
