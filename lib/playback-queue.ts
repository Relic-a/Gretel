import type { FeedVideo } from "./feed/types";

/** The queue is an ordered list with a cursor, rather than a consumable stack. */
export type PlaybackQueueState = {
  items: FeedVideo[];
  currentVideoId: string | null;
  autoplayEnabled: boolean;
};

export type QueueTransition =
  | { kind: "advanced"; state: PlaybackQueueState; video: FeedVideo }
  | { kind: "stopped"; state: PlaybackQueueState; video: FeedVideo | null }
  | { kind: "ended"; state: PlaybackQueueState; video: null };

export const DEFAULT_AUTOPLAY_ENABLED = true;

export function createPlaybackQueue(
  items: FeedVideo[] = [],
  options: { currentVideoId?: string | null; autoplayEnabled?: boolean } = {}
): PlaybackQueueState {
  const normalized = normalizeQueueItems(items);
  const requestedCurrent = options.currentVideoId ?? null;

  return {
    items: normalized,
    currentVideoId: normalized.some((video) => video.id === requestedCurrent) ? requestedCurrent : null,
    autoplayEnabled: options.autoplayEnabled ?? DEFAULT_AUTOPLAY_ENABLED
  };
}

/** Add videos to the tail while preserving existing order and removing duplicate IDs. */
export function enqueueVideos(state: PlaybackQueueState, videos: FeedVideo[]): PlaybackQueueState {
  const items = state.items.map((video) => video);
  const indexes = new Map(items.map((video, index) => [video.id, index]));

  for (const video of videos) {
    const normalized = normalizeQueueVideo(video);
    if (!normalized) continue;

    const existingIndex = indexes.get(normalized.id);
    if (existingIndex === undefined) {
      indexes.set(normalized.id, items.length);
      items.push(normalized);
    } else {
      // Refresh metadata without changing a user's chosen queue order.
      items[existingIndex] = normalized;
    }
  }

  return { ...state, items };
}

export function removeFromQueue(state: PlaybackQueueState, videoId: string): PlaybackQueueState {
  const index = state.items.findIndex((video) => video.id === videoId);
  if (index < 0) return state;

  const items = state.items.filter((video) => video.id !== videoId);
  if (state.currentVideoId !== videoId) {
    return { ...state, items };
  }

  // Removing the current item picks the item that occupied its slot, or the
  // preceding item when it was the tail. It never wraps around.
  const replacement = items[index] || items[index - 1] || null;
  return { ...state, items, currentVideoId: replacement?.id || null };
}

export function clearQueue(state: PlaybackQueueState): PlaybackQueueState {
  return { ...state, items: [], currentVideoId: null };
}

/** Move an item using its zero-based position in the complete queue. */
export function reorderQueue(
  state: PlaybackQueueState,
  videoId: string,
  toIndex: number
): PlaybackQueueState {
  const fromIndex = state.items.findIndex((video) => video.id === videoId);
  if (fromIndex < 0 || !Number.isInteger(toIndex) || state.items.length < 2) return state;

  const boundedIndex = Math.max(0, Math.min(toIndex, state.items.length - 1));
  if (fromIndex === boundedIndex) return state;

  const items = state.items.slice();
  const [video] = items.splice(fromIndex, 1);
  items.splice(boundedIndex, 0, video);
  return { ...state, items };
}

export function setCurrentVideo(state: PlaybackQueueState, videoId: string | null): PlaybackQueueState {
  if (videoId === null) return { ...state, currentVideoId: null };
  return state.items.some((video) => video.id === videoId)
    ? { ...state, currentVideoId: videoId }
    : state;
}

export function setAutoplayEnabled(state: PlaybackQueueState, enabled: boolean): PlaybackQueueState {
  return { ...state, autoplayEnabled: enabled };
}

export function getCurrentVideo(state: PlaybackQueueState): FeedVideo | null {
  return state.items.find((video) => video.id === state.currentVideoId) || null;
}

export function getUpNextVideos(state: PlaybackQueueState): FeedVideo[] {
  const currentIndex = state.items.findIndex((video) => video.id === state.currentVideoId);
  return currentIndex < 0 ? state.items.slice() : state.items.slice(currentIndex + 1);
}

/** Advance explicitly (for example, a user pressing Next), without autoplay gating. */
export function advanceQueue(state: PlaybackQueueState): QueueTransition {
  const currentIndex = state.items.findIndex((video) => video.id === state.currentVideoId);
  const next = currentIndex < 0 ? state.items[0] : state.items[currentIndex + 1];

  if (!next) {
    return { kind: "ended", state, video: null };
  }

  const nextState = { ...state, currentVideoId: next.id };
  return { kind: "advanced", state: nextState, video: next };
}

/** Resolve an ended player event. Autoplay never wraps from the tail to the head. */
export function handlePlaybackEnded(state: PlaybackQueueState): QueueTransition {
  if (!state.autoplayEnabled) {
    return { kind: "stopped", state, video: getCurrentVideo(state) };
  }

  return advanceQueue(state);
}

export function normalizeQueueItems(items: FeedVideo[]): FeedVideo[] {
  const normalized: FeedVideo[] = [];
  const seen = new Set<string>();

  for (const video of items) {
    const next = normalizeQueueVideo(video);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }

  return normalized;
}

function normalizeQueueVideo(video: FeedVideo): FeedVideo | null {
  if (!video || typeof video.id !== "string" || !video.id.trim()) return null;
  return { ...video, id: video.id.trim() };
}
