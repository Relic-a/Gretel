import { getGretelConfig } from "./config";
import { observeOperation } from "./observation";
import type { FeedObservation, FeedVideo } from "./types";
import { normalizeChannelKey } from "../profile-store";
import { errorFields, logWarn } from "../logger";
import {
  getAuthor,
  getDuration,
  getTitle,
  getVideoId,
  shouldKeepVideo
} from "./video-utils";
import { getYoutubeClient } from "./youtube-client";

export async function recommendVideosFromSeeds(
  sourceVideos: FeedVideo[],
  observation: FeedObservation,
  profileId: string,
  sourceLabel = "Recommended from",
  budgetForSeed: (seed: FeedVideo, seeds: FeedVideo[]) => number
) {
  return observeOperation(
    observation,
    "feed.related_videos",
    { sourceVideos: sourceVideos.length },
    async () => {
      const seedVideos = sourceVideos.slice(0, getGretelConfig().feed.recommendationSeeds);
      const limitedSeedVideos = seedVideos.slice(0, getGretelConfig().expansion.maxFetchCallsPerCycle);

      if (limitedSeedVideos.length === 0) {
        return { value: [], output: { recommendationVideos: 0 } };
      }

      const recommendationVideos = await recommendVideosFromLinks(
        limitedSeedVideos,
        observation,
        profileId,
        sourceLabel,
        budgetForSeed
      );
      return {
        value: recommendationVideos,
        output: { recommendationVideos: recommendationVideos.length }
      };
    }
  );
}

async function recommendVideosFromLinks(
  seedVideos: FeedVideo[],
  observation: FeedObservation,
  profileId: string,
  sourceLabel: string,
  budgetForSeed: (seed: FeedVideo, seeds: FeedVideo[]) => number
) {
  return observeOperation(
    observation,
    "youtube.getInfo.recommendations",
    { seedLinks: seedVideos.length },
    async () => {
      const youtube = await getYoutubeClient(profileId);
      const config = getGretelConfig();
      const maxVideos = config.feed.maxVideos;
      const seen = new Set<string>();
      const recommendations: FeedVideo[] = [];
      let lastFetchAt = 0;

      for (const seedVideo of seedVideos) {
        const seedId = seedVideo.id;

        if (!seedId) {
          continue;
        }

        try {
          const elapsedMs = Date.now() - lastFetchAt;

          if (lastFetchAt > 0 && elapsedMs < config.expansion.minDelayBetweenFetchesMs) {
            await delay(config.expansion.minDelayBetweenFetchesMs - elapsedMs);
          }

          const info = await youtube.getInfo(seedId);
          lastFetchAt = Date.now();
          let seedRecommendations = 0;
          const maxVideosPerSeed = budgetForSeed(seedVideo, seedVideos);

          for (const video of info.watch_next_feed || []) {
            const id = getVideoId(video);
            const duration = getDuration(video);

            if (id === seedId || !shouldKeepVideo(id, seen)) {
              continue;
            }

            seen.add(id);
            const author = getAuthor(video);
            recommendations.push({
              id,
              title: getTitle(video),
              author,
              duration,
              query: sourceLabel,
              channelKey: normalizeChannelKey(author),
              parent_video_id: seedVideo.id,
              parent_title: seedVideo.title,
              parent_author: seedVideo.author,
              recommendation_depth: (seedVideo.recommendation_depth || 0) + 1
            });
            seedRecommendations += 1;

            if (recommendations.length >= maxVideos) {
              return {
                value: recommendations,
                output: { recommendationVideos: recommendations.length }
              };
            }

            if (seedRecommendations >= maxVideosPerSeed) {
              break;
            }
          }
        } catch (error) {
          logWarn("youtube.recommendations_failed", {
            requestId: observation.requestId,
            seedId,
            ...errorFields(error)
          });
        }
      }

      return {
        value: recommendations,
        output: { recommendationVideos: recommendations.length }
      };
    }
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
