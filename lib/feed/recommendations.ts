import { MAX_VIDEOS, RECOMMENDATION_SEEDS } from "./config";
import { observeOperation } from "./observation";
import type { FeedObservation, FeedVideo } from "./types";
import {
  getAuthor,
  getDuration,
  getTitle,
  getVideoId,
  getVideoIdFromLink,
  nextUniqueVideo,
  promptAvoidsShorts,
  shouldKeepVideo
} from "./video-utils";
import { getYoutubeClient } from "./youtube-client";

export async function blendVideosWithRecommendations(
  sourceVideos: FeedVideo[],
  prompt: string,
  observation: FeedObservation
) {
  return observeOperation(
    observation,
    "feed.integrate_recommendations",
    { sourceVideos: sourceVideos.length },
    async () => {
      const seedLinks = sourceVideos
        .slice(0, RECOMMENDATION_SEEDS)
        .map((video) => `https://www.youtube.com/watch?v=${video.id}`);
      const recommendationVideos = await recommendVideosFromLinks(seedLinks, prompt, observation);

      if (recommendationVideos.length === 0) {
        return {
          value: sourceVideos,
          output: {
            recommendationVideos: 0,
            integratedVideos: sourceVideos.length
          }
        };
      }

      const seen = new Set<string>();
      const blended: FeedVideo[] = [];
      let recommendationIndex = 0;
      let searchIndex = 0;

      while (blended.length < MAX_VIDEOS) {
        let added = false;

        for (let count = 0; count < 2; count += 1) {
          const video = nextUniqueVideo(recommendationVideos, seen, recommendationIndex);
          recommendationIndex = video.nextIndex;

          if (video.item) {
            blended.push(video.item);
            added = true;
          }
        }

        const video = nextUniqueVideo(sourceVideos, seen, searchIndex);
        searchIndex = video.nextIndex;

        if (video.item) {
          blended.push(video.item);
          added = true;
        }

        if (!added) {
          break;
        }
      }

      const videos = blended.slice(0, MAX_VIDEOS);
      return {
        value: videos,
        output: {
          recommendationVideos: recommendationVideos.length,
          integratedVideos: videos.length
        }
      };
    }
  );
}

async function recommendVideosFromLinks(
  videoLinks: string[],
  prompt: string,
  observation: FeedObservation
) {
  return observeOperation(
    observation,
    "youtube.getInfo.recommendations",
    { seedLinks: videoLinks.length },
    async () => {
      const youtube = await getYoutubeClient();
      const seen = new Set<string>();
      const recommendations: FeedVideo[] = [];
      const avoidShorts = promptAvoidsShorts(prompt);

      for (const link of videoLinks) {
        const seedId = getVideoIdFromLink(link);

        if (!seedId) {
          continue;
        }

        try {
          const info = await youtube.getInfo(seedId);

          for (const video of info.watch_next_feed || []) {
            const id = getVideoId(video);
            const duration = getDuration(video);

            if (id === seedId || !shouldKeepVideo(id, duration, seen, avoidShorts)) {
              continue;
            }

            seen.add(id);
            recommendations.push({
              id,
              title: getTitle(video),
              author: getAuthor(video),
              duration,
              query: `Recommended from ${seedId}`
            });

            if (recommendations.length >= MAX_VIDEOS) {
              return {
                value: recommendations,
                output: { recommendationVideos: recommendations.length }
              };
            }
          }
        } catch (error) {
          console.error(`YouTube recommendations failed for "${link}":`, error);
        }
      }

      return {
        value: recommendations,
        output: { recommendationVideos: recommendations.length }
      };
    }
  );
}
