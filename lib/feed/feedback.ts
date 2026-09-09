import type { FeedVideo } from "./types";

export const feedbackActions = ["notInterested", "hideVideo", "muteChannel"] as const;

export type FeedbackAction = (typeof feedbackActions)[number];

export type ContentFeedbackState = {
  notInterestedVideoIds: ReadonlySet<string>;
  hiddenVideoIds: ReadonlySet<string>;
  mutedChannelIds: ReadonlySet<string>;
  mutedChannelKeys: ReadonlySet<string>;
};

export type ContentFeedbackSnapshot = {
  notInterestedVideoIds: string[];
  hiddenVideoIds: string[];
  mutedChannelIds: string[];
  mutedChannelKeys: string[];
};

export const emptyContentFeedback: ContentFeedbackState = {
  notInterestedVideoIds: new Set(),
  hiddenVideoIds: new Set(),
  mutedChannelIds: new Set(),
  mutedChannelKeys: new Set()
};

const feedbackActionAliases: Record<string, FeedbackAction> = {
  notInterested: "notInterested",
  "not-interested": "notInterested",
  not_interested: "notInterested",
  hideVideo: "hideVideo",
  "hide-video": "hideVideo",
  hide_video: "hideVideo",
  muteChannel: "muteChannel",
  "mute-channel": "muteChannel",
  mute_channel: "muteChannel"
};

export function parseFeedbackAction(value: unknown): FeedbackAction | null {
  return typeof value === "string" ? feedbackActionAliases[value] || null : null;
}

export function normalizeFeedbackKey(value: string | undefined) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function feedbackChannelKey(video: Pick<FeedVideo, "channelId" | "channelKey" | "author">) {
  return normalizeFeedbackKey(video.channelKey || video.author);
}

export function isFeedbackExcluded(video: Pick<FeedVideo, "id" | "channelId" | "channelKey" | "author">, feedback: ContentFeedbackState) {
  if (feedback.hiddenVideoIds.has(video.id) || feedback.notInterestedVideoIds.has(video.id)) {
    return true;
  }

  const channelId = normalizeFeedbackKey(video.channelId);
  const channelKey = feedbackChannelKey(video);
  return Boolean(
    (channelId && feedback.mutedChannelIds.has(channelId)) ||
    (channelKey && feedback.mutedChannelKeys.has(channelKey))
  );
}

export function filterFeedbackVideos<T extends Pick<FeedVideo, "id" | "channelId" | "channelKey" | "author">>(
  videos: T[],
  feedback: ContentFeedbackState
) {
  return videos.filter((video) => !isFeedbackExcluded(video, feedback));
}

export function toContentFeedbackSnapshot(feedback: ContentFeedbackState): ContentFeedbackSnapshot {
  return {
    notInterestedVideoIds: [...feedback.notInterestedVideoIds].sort(),
    hiddenVideoIds: [...feedback.hiddenVideoIds].sort(),
    mutedChannelIds: [...feedback.mutedChannelIds].sort(),
    mutedChannelKeys: [...feedback.mutedChannelKeys].sort()
  };
}
