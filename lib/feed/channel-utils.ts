import { Innertube } from "youtubei.js";
import { getText, getVideoId } from "./video-utils";

export function getChannelIdFromInput(input: string) {
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

export function getChannelId(channel: unknown) {
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

export function getChannelVideoItems(page: unknown): unknown[] {
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

export async function applyChannelSort<T extends { sort_filters?: string[]; applySort?: (sort: string) => Promise<T> }>(
  channel: T,
  sort: "latest" | "popular",
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
