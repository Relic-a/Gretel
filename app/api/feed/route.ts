import { parseChannelSort, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { createFeed } from "../../../lib/feed/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const observation = createFeedObservation();

  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const tags = parseTags(body.tags);
    const channels = parseTags(body.channels);
    const channelSort = parseChannelSort(body.channelSort);

    if (tags.length === 0 && channels.length === 0) {
      return Response.json(
        { error: "Enter at least one tag or channel to build a feed." },
        { status: 400 }
      );
    }

    const feed = await createFeed(tags, channels, channelSort, prompt, observation);

    logFeedObservation(observation, {
      tags: tags.length,
      channels: channels.length,
      channelSort,
      queries: feed.queries.length,
      searchVideos: feed.searchVideos,
      channelVideos: feed.channelVideos,
      finalVideos: feed.videos.length,
      usedRecommendations: true
    });

    return Response.json({
      prompt: prompt || undefined,
      tags,
      channels,
      channelSort,
      queries: feed.queries,
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

