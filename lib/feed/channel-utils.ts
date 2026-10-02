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

  // Feed.videos in youtubei.js 17 omits modern LockupView video cards.
  // Merge all supported page shapes, including filtered/continuation memos.
  const candidates: unknown[] = [];
  if ("videos" in page && Array.isArray(page.videos)) candidates.push(...page.videos);
  candidates.push(...getRichGridVideos(page));
  const source = page as Record<string, unknown>;
  const parsed = source.page as Record<string, unknown> | undefined;
  for (const memo of [source.memo, source.on_response_received_actions_memo,
    parsed?.contents_memo, parsed?.on_response_received_actions_memo,
    parsed?.on_response_received_endpoints_memo, parsed?.on_response_received_commands_memo]) {
    if (!(memo instanceof Map)) continue;
    for (const type of ["RichItem", "LockupView"]) {
      const items = memo.get(type);
      if (Array.isArray(items)) candidates.push(...items.flatMap(item =>
        type === "RichItem" ? getContentItem(item) : [item]));
    }
  }
  const seen = new Set<string>();
  return candidates.filter(item => {
    if (!item || typeof item !== "object") return false;
    if ("content_type" in item && item.content_type !== "VIDEO") return false;
    const id = getVideoId(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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
