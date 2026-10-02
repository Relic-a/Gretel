import { YT, YTNodes } from "youtubei.js";
import { ChannelPager } from "./channel-pager";
import { getYoutubeClient } from "./youtube-client";
import { searchChannels } from "./youtube";
import { getChannelIdFromInput, getChannelVideoItems } from "./channel-utils";
import { getAuthorAvatarUrl, getChannelAvatarUrl, getChannelVideoAuthor, getDuration, getPublishedAt, getPublishedText, getThumbnailUrl, getTitle, getVideoId, getViewCount } from "./video-utils";
import { rememberChannelAvatar } from "./channel-avatar-cache";
import type { FeedVideo } from "./types";

type Channel = Awaited<ReturnType<Awaited<ReturnType<typeof getYoutubeClient>>["getChannel"]>>;
type Page = Channel | Awaited<ReturnType<Channel["getContinuation"]>> | Awaited<ReturnType<Channel["applyFilter"]>>;
type Entry = { id: string; time: number; pager: ChannelPager<FeedVideo, Page>; channel?: { id: string; name: string; thumbnailUrl?: string }; sorts: string[] };
const cache = new Map<string, Entry>();
const ttl = 10 * 60_000;
const bases = new Map<string, { time: number; promise: Promise<{ channel: Channel; videos: Channel; id: string }> }>();
function channelBase(profileId: string, input: string) {
  const key = JSON.stringify([profileId, input]);
  for (const [key, base] of bases) if (Date.now() - base.time > ttl) bases.delete(key);
  const existing = bases.get(key);
  if (existing) return existing.promise;
  const promise = (async () => {
    const resolved = getChannelIdFromInput(input) || (await searchChannels(input, profileId))[0]?.id;
    if (!resolved) throw new Error("Channel not found.");
    const channel = await (await getYoutubeClient(profileId)).getChannel(resolved);
    return { channel, videos: channel.has_videos ? await channel.getVideos() : channel, id: resolved };
  })();
  if (bases.size >= 40) bases.delete(bases.keys().next().value!);
  bases.set(key, { time: Date.now(), promise });
  void promise.catch(() => { if (bases.get(key)?.promise === promise) bases.delete(key); });
  return promise;
}

export async function browseChannel(profileId: string, input: string, sort = "", cursor?: { session: string; page: number }, refresh = false) {
  for (const [key, entry] of cache) if (Date.now() - entry.time > ttl) cache.delete(key);
  if (refresh) {
    bases.delete(JSON.stringify([profileId, input]));
    for (const key of cache.keys()) {
      const [owner, channel] = JSON.parse(key);
      if (owner === profileId && channel === input) cache.delete(key);
    }
  }
  const key = JSON.stringify([profileId, input, sort]);
  let entry = cache.get(key);
  if (cursor && (!entry || entry.id !== cursor.session)) throw new Error("Channel session expired. Reload the channel.");
  if (!entry) {
    const created: Entry = {
      id: crypto.randomUUID(), time: Date.now(), sorts: [],
      pager: new ChannelPager<FeedVideo, Page>(async () => {
        const { channel, videos, id: resolved } = await channelBase(profileId, input);
        const name = channel.metadata?.title || input;
        const thumbnailUrl = getChannelAvatarUrl(channel);
        created.channel = { id: resolved, name, thumbnailUrl };
        rememberChannelAvatar({ channelId: resolved, channelName: name }, thumbnailUrl);
        if (!channel.has_videos) return channel;
        const chips = videos.memo?.getType(YTNodes.ChipBarView)[0]?.chips || [];
        created.sorts = videos.sort_filters.length ? videos.sort_filters
          : videos.filters.length ? videos.filters : chips.map(chip => chip.text);
        if (!sort || sort === created.sorts[0]) return videos;
        if (!created.sorts.includes(sort)) throw new Error("This sort is unavailable for this channel.");
        if (videos.sort_filters.length) return videos.applySort(sort);
        if (videos.filters.length) return videos.applyFilter(sort);
        const chip = chips.find(chip => chip.text === sort);
        if (!chip) throw new Error("This sort is unavailable for this channel.");
        const youtube = await getYoutubeClient(profileId);
        const response = await chip.endpoint.call(youtube.actions, { parse: true });
        return new YT.ChannelListContinuation(youtube.actions, response, true);
      }, page => page.getContinuation(), page => {
        const channel = created.channel!;
        return getChannelVideoItems(page).flatMap(video => {
          const id = getVideoId(video);
          return id ? [{ itemType: "video" as const, id, title: getTitle(video), author: getChannelVideoAuthor(video, channel.name),
            channelId: channel.id, channelAvatarUrl: getAuthorAvatarUrl(video) || channel.thumbnailUrl,
            duration: getDuration(video), query: channel.name, thumbnailUrl: getThumbnailUrl(video, id),
            thumbnailCacheUrl: `/api/thumbnails/${id}`, publishedText: getPublishedText(video),
            publishedAt: getPublishedAt(video), viewCount: getViewCount(video) }] : [];
        });
      }, page => Boolean(page.has_continuation))
    };
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    entry = created;
    cache.set(key, entry);
  }
  entry.time = Date.now();
  try {
    const index = cursor?.page ?? 0;
    const result = await entry.pager.getPage(index);
    return { channel: entry.channel!, sorts: entry.sorts, videos: result.items,
      cursor: result.hasMore ? { session: entry.id, page: index + 1 } : null };
  } catch (error) {
    if (!entry.channel) cache.delete(key);
    throw error;
  }
}
