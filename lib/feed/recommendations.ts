import { getGretelConfig } from "./config";
import { observeOperation } from "./observation";
import type { FeedObservation, FeedVideo } from "./types";
import { normalizeChannelKey } from "../profile-store";
import { errorFields, logWarn } from "../logger";
import {
  getAuthor,
  getAuthorAvatarUrl,
  getAuthorChannelId,
  getChannelAvatarUrl,
  getDuration,
  getPublishedAt,
  getPublishedText,
  getThumbnailUrl,
  getTitle,
  getViewCount,
  getVideoId,
  shouldKeepVideo
} from "./video-utils";
import { getYoutubeClient } from "./youtube-client";
import { resolveMissingChannelAvatars } from "./channel-avatar-cache";

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
      const maxVideos = config.expansion.maxVideosPerCycle;
      const seen = new Set<string>();
      const recommendations: FeedVideo[] = [];
      const fetchConcurrency = 3;
      const seedRecommendations: Array<{ seedVideo: FeedVideo; feed: unknown[] } | null> = [];
      const fetchSeed = async (seedVideo: FeedVideo) => {
        const seedId = seedVideo.id;

        if (!seedId) {
          return null;
        }

        try {
          const info = await youtube.getInfo(seedId);

          return {
            seedVideo,
            feed: info.watch_next_feed || []
          };
        } catch (error) {
          logWarn("youtube.recommendations_failed", {
            requestId: observation.requestId,
            seedId,
            ...errorFields(error)
          });
          return null;
        }
      };

      for (let index = 0; index < seedVideos.length; index += fetchConcurrency) {
        const batch = seedVideos.slice(index, index + fetchConcurrency);
        const batchRecommendations = await Promise.all(batch.map((seedVideo) => fetchSeed(seedVideo)));
        seedRecommendations.push(...batchRecommendations);

        if (
          index + fetchConcurrency < seedVideos.length &&
          config.expansion.minDelayBetweenFetchesMs > 0
        ) {
          await delay(config.expansion.minDelayBetweenFetchesMs);
        }
      }

      for (const seedRecommendation of seedRecommendations) {
        if (!seedRecommendation) {
          continue;
        }

        const { seedVideo, feed } = seedRecommendation;
        const seedId = seedVideo.id;
        let seedVideoCount = 0;
        const maxVideosPerSeed = budgetForSeed(seedVideo, seedVideos);

        for (const video of feed) {
          const id = getVideoId(video);
          const duration = getDuration(video);

          if (id === seedId || !shouldKeepVideo(id, seen)) {
            continue;
          }

          seen.add(id);
          const author = getAuthor(video);
          const channelId = getAuthorChannelId(video);
          recommendations.push({
            id,
            title: getTitle(video),
            author,
            channelAvatarUrl: getAuthorAvatarUrl(video),
            duration,
            query: sourceLabel,
            thumbnailUrl: getThumbnailUrl(video) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            thumbnailCacheUrl: `/api/thumbnails/${profileId}/${id}`,
            publishedText: getPublishedText(video),
            publishedAt: getPublishedAt(video),
            viewCount: getViewCount(video),
            channelKey: normalizeChannelKey(author),
            channelId,
            parent_video_id: seedVideo.id,
            parent_title: seedVideo.title,
            parent_author: seedVideo.author,
            recommendation_depth: (seedVideo.recommendation_depth || 0) + 1
          });
          seedVideoCount += 1;

          if (recommendations.length >= maxVideos) {
            const recommendationsWithAvatars = await resolveMissingChannelAvatars(
              recommendations,
              async (channelId) => getChannelAvatarUrl(await youtube.getChannel(channelId))
            );
            return {
              value: recommendationsWithAvatars,
              output: { recommendationVideos: recommendationsWithAvatars.length }
            };
          }

          if (seedVideoCount >= maxVideosPerSeed) {
            break;
          }
        }
      }

      const recommendationsWithAvatars = await resolveMissingChannelAvatars(
        recommendations,
        async (channelId) => getChannelAvatarUrl(await youtube.getChannel(channelId))
      );
      return {
        value: recommendationsWithAvatars,
        output: { recommendationVideos: recommendationsWithAvatars.length }
      };
    }
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
