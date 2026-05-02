import { getGretelConfig } from "./config";
import { observeOperation } from "./observation";
import type { FeedObservation, FeedVideo } from "./types";
import { normalizeChannelKey } from "../profile-store";
import {
  getAuthor,
  getDuration,
  getTitle,
  getVideoId,
  getVideoIdFromLink,
  promptAvoidsShorts,
  shouldKeepVideo
} from "./video-utils";
import { getYoutubeClient } from "./youtube-client";

export async function recommendVideosFromSeeds(
  sourceVideos: FeedVideo[],
  prompt: string,
  observation: FeedObservation,
  profileId: string,
  sourceLabel = "Recommended from"
) {
  return observeOperation(
    observation,
    "feed.related_videos",
    { sourceVideos: sourceVideos.length },
    async () => {
      const seedLinks = sourceVideos
        .slice(0, getGretelConfig().feed.recommendationSeeds)
        .map((video) => `https://www.youtube.com/watch?v=${video.id}`);

      if (seedLinks.length === 0) {
        return { value: [], output: { recommendationVideos: 0 } };
      }

      const recommendationVideos = await recommendVideosFromLinks(
        seedLinks,
        prompt,
        observation,
        profileId,
        sourceLabel
      );
      return {
        value: recommendationVideos,
        output: { recommendationVideos: recommendationVideos.length }
      };
    }
  );
}

async function recommendVideosFromLinks(
  videoLinks: string[],
  prompt: string,
  observation: FeedObservation,
  profileId: string,
  sourceLabel: string
) {
  return observeOperation(
    observation,
    "youtube.getInfo.recommendations",
    { seedLinks: videoLinks.length },
    async () => {
      const youtube = await getYoutubeClient(profileId);
      const maxVideos = getGretelConfig().feed.maxVideos;
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
            const author = getAuthor(video);
            recommendations.push({
              id,
              title: getTitle(video),
              author,
              duration,
              query: `${sourceLabel} ${seedId}`,
              channelKey: normalizeChannelKey(author)
            });

            if (recommendations.length >= maxVideos) {
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
