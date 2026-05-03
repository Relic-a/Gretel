import type { GretelConfig } from "./config-defaults";
import type { FeedVideo } from "./types";

export type VideoInteraction = {
  videoId: string;
  watchTimeRatio: number;
  liked: boolean;
  clicked: boolean;
  ignoreCount: number;
};

export function computeEngagementScore(
  interaction: Pick<VideoInteraction, "watchTimeRatio" | "liked" | "clicked" | "ignoreCount">,
  config: GretelConfig["learning"]
) {
  return (
    clampShare(interaction.watchTimeRatio) * config.watchTimeWeight +
    (interaction.liked ? config.likedWeight : 0) +
    (interaction.clicked ? config.clickedWeight : 0) -
    ignoreDecay(interaction.ignoreCount, config)
  );
}

export function applyEngagement(video: FeedVideo, interactions: Map<string, VideoInteraction>, config: GretelConfig) {
  const interaction = interactions.get(video.id);
  const watchTimeRatio = interaction?.watchTimeRatio || video.watchTimeRatio || 0;
  const liked = interaction?.liked || video.liked || false;
  const clicked = interaction?.clicked || video.clicked || false;
  const ignoreCount = interaction?.ignoreCount ?? video.ignoreCount ?? 0;
  const engagementScore = computeEngagementScore(
    { watchTimeRatio, liked, clicked, ignoreCount },
    config.learning
  );

  return {
    ...video,
    watchTimeRatio,
    liked,
    clicked,
    ignoreCount,
    engagementScore
  };
}

function ignoreDecay(ignoreCount: number, config: GretelConfig["learning"]) {
  if (ignoreCount <= 0) {
    return 0;
  }

  return config.ignorePenaltyBase * config.ignorePenaltyGrowth ** (ignoreCount - 1);
}

function clampShare(value: number) {
  return Math.min(1, Math.max(0, value));
}
