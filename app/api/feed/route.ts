import { Innertube } from "youtubei.js";

export const runtime = "nodejs";

type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  query: string;
};

type FeedObservation = {
  requestId: string;
  startedAt: number;
  operations: Array<{
    name: string;
    durationMs: number;
    input?: Record<string, number | string | boolean>;
    output?: Record<string, number | string | boolean>;
  }>;
};

type ChannelSort = "latest" | "popular";

const MAX_QUERIES = 5;
const MAX_VIDEOS = 18;
const RECOMMENDATION_SEEDS = 4;

let youtubeClient: Promise<Innertube> | null = null;

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

    const queries = createQueries(tags);
    const searchVideosForQueries =
      queries.length > 0 ? await searchVideos(queries, prompt, observation) : [];
    const channelVideos =
      channels.length > 0 ? await fetchChannelVideos(channels, channelSort, prompt, observation) : [];
    const videos = await blendVideosWithRecommendations(
      [...searchVideosForQueries, ...channelVideos],
      prompt,
      observation
    );

    logFeedObservation(observation, {
      tags: tags.length,
      channels: channels.length,
      channelSort,
      queries: queries.length,
      searchVideos: searchVideosForQueries.length,
      channelVideos: channelVideos.length,
      finalVideos: videos.length,
      usedRecommendations: true
    });

    return Response.json({ prompt: prompt || undefined, tags, channels, channelSort, queries, videos });
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

function createQueries(tags: string[]) {
  return tags.slice(0, MAX_QUERIES);
}

function parseTags(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return cleanQueries(
    values.flatMap((entry) => (typeof entry === "string" ? entry.split(/[,\n]/) : []))
  );
}

function parseChannelSort(value: unknown): ChannelSort {
  return value === "popular" ? "popular" : "latest";
}

function cleanQueries(values: unknown[]) {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const query = value.replace(/\s+/g, " ").trim();
    const key = query.toLowerCase();

    if (query.length > 2 && !seen.has(key)) {
      seen.add(key);
      queries.push(query.slice(0, 120));
    }

    if (queries.length === MAX_QUERIES) {
      break;
    }
  }

  return queries;
}

async function searchVideos(
  queries: string[],
  prompt: string,
  observation: FeedObservation
) {
  return observeOperation(
    observation,
    "youtube.search",
    { queries: queries.length },
    async () => {
      if (!youtubeClient) {
        youtubeClient = Innertube.create();
      }

      const youtube = await youtubeClient;
      const seen = new Set<string>();
      const videosByQuery: FeedVideo[][] = [];
      const avoidShorts = /\b(no|avoid|exclude|without)\s+shorts?\b/i.test(prompt);
      const perQueryLimit = Math.max(3, Math.ceil(MAX_VIDEOS / queries.length));

      for (const query of queries) {
        const results = await youtube.search(query);
        const queryVideos: FeedVideo[] = [];

        for (const video of results.videos) {
          const id = getVideoId(video);
          const duration = getDuration(video);

          if (!id || seen.has(id)) {
            continue;
          }

          if (avoidShorts && getDurationSeconds(duration) > 0 && getDurationSeconds(duration) < 60) {
            continue;
          }

          seen.add(id);
          queryVideos.push({
            id,
            title: getTitle(video),
            author: getAuthor(video),
            duration,
            query
          });

          if (queryVideos.length >= perQueryLimit) {
            break;
          }
        }

        videosByQuery.push(queryVideos);
      }

      const mixed = mixVideoBuckets(videosByQuery);

      return {
        value: mixed,
        output: {
          rawVideos: videosByQuery.reduce((total, videos) => total + videos.length, 0),
          integratedVideos: mixed.length
        }
      };
    }
  );
}

async function fetchChannelVideos(
  channels: string[],
  sort: ChannelSort,
  prompt: string,
  observation: FeedObservation
) {
  return observeOperation(
    observation,
    "youtube.channel_videos",
    { channels: channels.length, sort },
    async () => {
      if (!youtubeClient) {
        youtubeClient = Innertube.create();
      }

      const youtube = await youtubeClient;
      const seen = new Set<string>();
      const videosByChannel: FeedVideo[][] = [];
      const avoidShorts = /\b(no|avoid|exclude|without)\s+shorts?\b/i.test(prompt);
      const perChannelLimit = Math.max(3, Math.ceil(MAX_VIDEOS / channels.length));

      for (const channelName of channels) {
        const channelId = await resolveChannelId(channelName, observation);

        if (!channelId) {
          videosByChannel.push([]);
          continue;
        }

        try {
          const channel = await youtube.getChannel(channelId);
          const latestChannelVideos = await channel.getVideos();
          const fallbackVideos = getChannelVideoItems(latestChannelVideos);
          const sortedChannelVideos = await applyChannelSort(latestChannelVideos, sort, youtube);
          const sortedVideos = getChannelVideoItems(sortedChannelVideos);
          const videosToRead = sortedVideos.length > 0 ? sortedVideos : fallbackVideos;
          const sourceVideos =
            sort === "popular"
              ? [...videosToRead].sort((a, b) => getViewCount(b) - getViewCount(a))
              : videosToRead;

          const channelVideos: FeedVideo[] = [];

          for (const video of sourceVideos) {
            const id = getVideoId(video);
            const duration = getDuration(video);

            if (!id || seen.has(id)) {
              continue;
            }

            if (avoidShorts && getDurationSeconds(duration) > 0 && getDurationSeconds(duration) < 60) {
              continue;
            }

            seen.add(id);
            channelVideos.push({
              id,
              title: getTitle(video),
              author: getChannelVideoAuthor(video, channelName),
              duration,
              query: `${channelName} · ${sort}`
            });

            if (channelVideos.length >= perChannelLimit) {
              break;
            }
          }

          videosByChannel.push(channelVideos);
        } catch (error) {
          console.error(`YouTube channel fetch failed for "${channelName}":`, error);
          videosByChannel.push([]);
        }
      }

      const mixed = mixVideoBuckets(videosByChannel);

      return {
        value: mixed,
        output: {
          rawVideos: videosByChannel.reduce((total, videos) => total + videos.length, 0),
          integratedVideos: mixed.length
        }
      };
    }
  );
}

async function resolveChannelId(channelName: string, observation: FeedObservation) {
  return observeOperation(
    observation,
    "youtube.resolve_channel",
    { channel: channelName },
    async () => {
      const directId = getChannelIdFromInput(channelName);

      if (directId) {
        return {
          value: directId,
          output: { resolved: true, direct: true }
        };
      }

      if (!youtubeClient) {
        youtubeClient = Innertube.create();
      }

      const youtube = await youtubeClient;
      const results = await youtube.search(channelName, { type: "channel" });
      const channel = results.channels[0];
      const channelId = getChannelId(channel);

      return {
        value: channelId,
        output: { resolved: Boolean(channelId), direct: false }
      };
    }
  );
}

async function applyChannelSort<T extends { sort_filters?: string[]; applySort?: (sort: string) => Promise<T> }>(
  channel: T,
  sort: ChannelSort,
  youtube: Innertube
) {
  const preferred = sort === "popular" ? ["Popular"] : ["Latest", "Recently uploaded", "Newest"];
  const selectedSort = preferred.find((option) => channel.sort_filters?.includes(option));

  if (selectedSort && channel.applySort) {
    try {
      return channel.applySort(selectedSort);
    } catch {
      // Recent youtubei.js channel pages expose sort chips without wiring sort_filters.
    }
  }

  const selectedChip = getChannelSortChip(channel, preferred);

  if (!selectedChip) {
    return channel;
  }

  try {
    return selectedChip.endpoint.call(youtube.actions, { parse: true });
  } catch {
    return channel;
  }
}

async function blendVideosWithRecommendations(
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
      if (!youtubeClient) {
        youtubeClient = Innertube.create();
      }

      const youtube = await youtubeClient;
      const seen = new Set<string>();
      const recommendations: FeedVideo[] = [];
      const avoidShorts = /\b(no|avoid|exclude|without)\s+shorts?\b/i.test(prompt);

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

            if (!id || id === seedId || seen.has(id)) {
              continue;
            }

            if (avoidShorts && getDurationSeconds(duration) > 0 && getDurationSeconds(duration) < 60) {
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

function createFeedObservation(): FeedObservation {
  return {
    requestId: crypto.randomUUID(),
    startedAt: performance.now(),
    operations: []
  };
}

async function observeOperation<T>(
  observation: FeedObservation,
  name: string,
  input: Record<string, number | string | boolean>,
  operation: () => Promise<T | { value: T; output: Record<string, number | string | boolean> }>
) {
  const startedAt = performance.now();
  const result = await operation();
  const durationMs = Math.round(performance.now() - startedAt);

  if (isObservedResult<T>(result)) {
    observation.operations.push({ name, durationMs, input, output: result.output });
    return result.value;
  }

  observation.operations.push({ name, durationMs, input });
  return result;
}

function isObservedResult<T>(
  value: T | { value: T; output: Record<string, number | string | boolean> }
): value is { value: T; output: Record<string, number | string | boolean> } {
  return Boolean(value && typeof value === "object" && "value" in value && "output" in value);
}

function logFeedObservation(
  observation: FeedObservation,
  summary: Record<string, number | string | boolean>
) {
  console.info(
    "[feed-observation]",
    JSON.stringify({
      requestId: observation.requestId,
      totalMs: Math.round(performance.now() - observation.startedAt),
      summary,
      operations: observation.operations
    })
  );
}

function nextUniqueVideo(videos: FeedVideo[], seen: Set<string>, startIndex: number) {
  for (let index = startIndex; index < videos.length; index += 1) {
    const video = videos[index];

    if (!seen.has(video.id)) {
      seen.add(video.id);
      return { item: video, nextIndex: index + 1 };
    }
  }

  return { item: null, nextIndex: videos.length };
}

function mixVideoBuckets(videoBuckets: FeedVideo[][]) {
  const mixed: FeedVideo[] = [];

  for (let index = 0; mixed.length < MAX_VIDEOS; index += 1) {
    let added = false;

    for (const videos of videoBuckets) {
      const video = videos[index];

      if (video) {
        mixed.push(video);
        added = true;
      }

      if (mixed.length >= MAX_VIDEOS) {
        break;
      }
    }

    if (!added) {
      break;
    }
  }

  return mixed;
}

function getVideoIdFromLink(link: string) {
  try {
    const url = new URL(link);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }

    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function getChannelIdFromInput(input: string) {
  if (/^UC[\w-]{20,}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    const channelMatch = url.pathname.match(/\/channel\/([^/?]+)/);

    if (channelMatch) {
      return channelMatch[1];
    }
  } catch {
    return "";
  }

  return "";
}

function getChannelId(channel: unknown) {
  if (!channel || typeof channel !== "object") {
    return "";
  }

  if ("id" in channel) {
    return getText(channel.id);
  }

  if ("channel_id" in channel) {
    return getText(channel.channel_id);
  }

  if ("endpoint" in channel) {
    return getBrowseId(channel.endpoint);
  }

  return "";
}

function getChannelVideoItems(page: unknown): unknown[] {
  if (!page || typeof page !== "object") {
    return [];
  }

  if ("videos" in page && Array.isArray(page.videos)) {
    return page.videos;
  }

  const richGridVideos = getRichGridVideos(page);

  if (richGridVideos.length > 0) {
    return richGridVideos;
  }

  if ("on_response_received_actions_memo" in page) {
    const memo = page.on_response_received_actions_memo;

    if (memo instanceof Map) {
      const richItems = memo.get("RichItem");

      if (Array.isArray(richItems)) {
        return richItems.flatMap((item) => getContentItem(item));
      }
    }
  }

  return [];
}

function getRichGridVideos(page: unknown): unknown[] {
  if (!page || typeof page !== "object" || !("current_tab" in page)) {
    return [];
  }

  const tab = page.current_tab;

  if (!tab || typeof tab !== "object" || !("content" in tab)) {
    return [];
  }

  const content = tab.content;

  if (!content || typeof content !== "object" || !("contents" in content) || !Array.isArray(content.contents)) {
    return [];
  }

  return content.contents.flatMap((item) => getContentItem(item));
}

function getContentItem(item: unknown): unknown[] {
  if (!item || typeof item !== "object" || !("content" in item)) {
    return [];
  }

  const content = item.content;

  if (content && typeof content === "object" && getVideoId(content)) {
    return [content];
  }

  return [];
}

function getChannelSortChip(page: unknown, labels: string[]) {
  if (!page || typeof page !== "object" || !("current_tab" in page)) {
    return null;
  }

  const tab = page.current_tab;

  if (!tab || typeof tab !== "object" || !("content" in tab)) {
    return null;
  }

  const content = tab.content;

  if (!content || typeof content !== "object" || !("header" in content)) {
    return null;
  }

  const header = content.header;

  if (!header || typeof header !== "object" || !("chips" in header) || !Array.isArray(header.chips)) {
    return null;
  }

  for (const chip of header.chips) {
    if (!chip || typeof chip !== "object" || !("text" in chip) || !("endpoint" in chip)) {
      continue;
    }

    const endpoint = chip.endpoint;
    const text = getText(chip.text);

    if (
      labels.includes(text) &&
      endpoint &&
      typeof endpoint === "object" &&
      "call" in endpoint &&
      typeof endpoint.call === "function"
    ) {
      return { endpoint };
    }
  }

  return null;
}

function getBrowseId(endpoint: unknown): string {
  if (!endpoint || typeof endpoint !== "object") {
    return "";
  }

  if ("payload" in endpoint) {
    const payload = endpoint.payload;

    if (payload && typeof payload === "object" && "browseId" in payload) {
      return getText(payload.browseId);
    }
  }

  return "";
}

function getVideoId(video: unknown) {
  if (!video || typeof video !== "object") {
    return "";
  }

  if ("content_id" in video) {
    return getText(video.content_id);
  }

  if ("video_id" in video) {
    return getText(video.video_id);
  }

  if ("id" in video) {
    return getText(video.id);
  }

  return "";
}

function getTitle(video: unknown) {
  if (!video || typeof video !== "object") {
    return "Untitled video";
  }

  if ("metadata" in video) {
    const metadata = video.metadata;

    if (metadata && typeof metadata === "object" && "title" in metadata) {
      return getText(metadata.title) || "Untitled video";
    }
  }

  if ("title" in video) {
    return getText(video.title) || "Untitled video";
  }

  if ("overlay_metadata" in video) {
    const metadata = video.overlay_metadata;

    if (metadata && typeof metadata === "object" && "primary_text" in metadata) {
      return getText(metadata.primary_text) || "Untitled video";
    }
  }

  return "Untitled video";
}

function getAuthor(video: unknown) {
  if (!video || typeof video !== "object") {
    return "Unknown channel";
  }

  if ("metadata" in video) {
    const metadata = video.metadata;

    if (metadata && typeof metadata === "object" && "image" in metadata) {
      const image = metadata.image;

      if (image && typeof image === "object" && "a11y_label" in image) {
        const label = getText(image.a11y_label).replace(/^Go to channel\s+/i, "").trim();

        if (label) {
          return label;
        }
      }
    }

    const rowAuthor = getAuthorFromMetadataRows(metadata);

    if (rowAuthor) {
      return rowAuthor;
    }
  }

  const author = "author" in video ? video.author : undefined;

  if (author && typeof author === "object" && "name" in author) {
    return getText(author.name) || "Unknown channel";
  }

  return "Unknown channel";
}

function getChannelVideoAuthor(video: unknown, channelName: string) {
  const author = getAuthor(video);

  if (!author || author === "N/A" || author === "Unknown channel") {
    return channelName;
  }

  return author;
}

function getDuration(video: unknown) {
  if (!video || typeof video !== "object") {
    return "";
  }

  if ("content_image" in video) {
    const duration = getDurationFromThumbnail(video.content_image);

    if (duration) {
      return duration;
    }
  }

  if ("duration" in video) {
    const duration = video.duration;

    if (duration && typeof duration === "object" && "text" in duration) {
      return getText(duration.text);
    }
  }

  if ("length_text" in video) {
    return getText(video.length_text);
  }

  return "";
}

function getViewCount(video: unknown) {
  if (!video || typeof video !== "object" || !("view_count" in video)) {
    return 0;
  }

  const text = getText(video.view_count);
  const count = Number(text.replace(/[^\d]/g, ""));

  return Number.isFinite(count) ? count : 0;
}

function getAuthorFromMetadataRows(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("metadata" in metadata)) {
    return "";
  }

  const contentMetadata = metadata.metadata;

  if (
    !contentMetadata ||
    typeof contentMetadata !== "object" ||
    !("metadata_rows" in contentMetadata) ||
    !Array.isArray(contentMetadata.metadata_rows)
  ) {
    return "";
  }

  for (const row of contentMetadata.metadata_rows) {
    if (!row || typeof row !== "object" || !("metadata_parts" in row) || !Array.isArray(row.metadata_parts)) {
      continue;
    }

    for (const part of row.metadata_parts) {
      if (!part || typeof part !== "object" || !("text" in part)) {
        continue;
      }

      const text = getText(part.text);

      if (text && !/\bviews?\b|ago$|watching/i.test(text)) {
        return text;
      }
    }
  }

  return "";
}

function getDurationFromThumbnail(contentImage: unknown) {
  if (!contentImage || typeof contentImage !== "object" || !("overlays" in contentImage)) {
    return "";
  }

  const overlays = contentImage.overlays;

  if (!Array.isArray(overlays)) {
    return "";
  }

  for (const overlay of overlays) {
    if (!overlay || typeof overlay !== "object" || !("badges" in overlay) || !Array.isArray(overlay.badges)) {
      continue;
    }

    for (const badge of overlay.badges) {
      if (!badge || typeof badge !== "object" || !("text" in badge)) {
        continue;
      }

      const text = getText(badge.text);

      if (/^\d+(?::\d+)+$/.test(text)) {
        return text;
      }
    }
  }

  return "";
}

function getDurationSeconds(duration: string) {
  const parts = duration
    .split(":")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) {
    return 0;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function getText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if ("text" in value) {
    return getText(value.text);
  }

  if ("toString" in value && typeof value.toString === "function") {
    const text = value.toString();
    return text === "[object Object]" ? "" : text;
  }

  return "";
}
