import { parseChannelSort, parseFeedNodeWeights, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { createFeed } from "../../../lib/feed/service";
import {
  getChannelBoosts,
  getLatestWatchedVideos,
  getNodeBoosts,
  getProfile,
  getWatchedVideoIds,
  listProfiles
} from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const observation = createFeedObservation();

  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const tags = parseTags(body.tags);
    const channels = parseTags(body.channels);
    const channelSort = parseChannelSort(body.channelSort);
    const weights = parseFeedNodeWeights(body.weights);
    const requestedProfileId = typeof body.profileId === "string" ? body.profileId : "";
    const profile = getProfile(requestedProfileId) || listProfiles()[0];

    if (tags.length === 0 && channels.length === 0 && prompt.length === 0) {
      return Response.json(
        { error: "Enter at least one tag, channel, or natural-language prompt to build a feed." },
        { status: 400 }
      );
    }

    if (Object.values(weights).every((weight) => weight === 0)) {
      return Response.json(
        { error: "Set at least one network weight above zero." },
        { status: 400 }
      );
    }

    const watchedVideoIds = getWatchedVideoIds(profile.id);
    const latestWatchedVideos = getLatestWatchedVideos(profile.id);
    const feed = await createFeed(
      profile.id,
      tags,
      channels,
      channelSort,
      prompt,
      weights,
      observation,
      {
        watchedVideoIds,
        nodeBoosts: getNodeBoosts(profile.id),
        channelBoosts: getChannelBoosts(profile.id)
      },
      latestWatchedVideos
    );

    logFeedObservation(observation, {
      tags: tags.length,
      channels: channels.length,
      channelSort,
      queries: feed.queries.length,
      searchVideos: feed.searchVideos,
      channelVideos: feed.channelVideos,
      finalVideos: feed.videos.length,
      activeNodes: feed.nodes.filter((node) => node.weight > 0).length,
      usedRecommendations: weights.relatedVideos > 0,
      watchedSeeds: latestWatchedVideos.length,
      watchedExcluded: watchedVideoIds.length
    });

    return Response.json({
      prompt: prompt || undefined,
      tags,
      channels,
      channelSort,
      profile,
      weights,
      queries: feed.queries,
      nodes: feed.nodes,
      videos: feed.videos
    });
  } catch (error) {
    logFeedObservation(observation, {
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(error);
    return Response.json(
      { error: "Feed generation failed. Check your API key and network access." },
      { status: 500 }
    );
  }
}
