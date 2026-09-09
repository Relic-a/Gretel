import {
  advanceQueue,
  clearQueue,
  createPlaybackQueue,
  enqueueVideos,
  getCurrentVideo,
  getUpNextVideos,
  handlePlaybackEnded,
  removeFromQueue,
  reorderQueue,
  setAutoplayEnabled,
  setCurrentVideo,
  type PlaybackQueueState,
  type QueueTransition
} from "./playback-queue";
import type { FeedVideo } from "./feed/types";
import { ensureProfileWritable, getDatabase, getProfile } from "./profile-store";

export type QueueSnapshot = PlaybackQueueState & {
  currentVideo: FeedVideo | null;
  upNextVideos: FeedVideo[];
};

export function getPlaybackQueue(profileId: string): QueueSnapshot {
  assertQueueProfile(profileId);
  const row = getDatabase()
    .prepare(
      `SELECT items_json, current_video_id, autoplay_enabled
       FROM playback_queues
       WHERE profile_id = ?`
    )
    .get(profileId) as {
      items_json: string;
      current_video_id: string | null;
      autoplay_enabled: number;
    } | undefined;

  const state = row
    ? decodeQueue(row)
    : createPlaybackQueue();
  return toSnapshot(state);
}

export function savePlaybackQueue(profileId: string, state: PlaybackQueueState): QueueSnapshot {
  assertQueueProfile(profileId);
  ensureProfileWritable(profileId);
  const normalized = createPlaybackQueue(state.items, {
    currentVideoId: state.currentVideoId,
    autoplayEnabled: state.autoplayEnabled
  });
  const now = Date.now();

  getDatabase()
    .prepare(
      `INSERT INTO playback_queues (profile_id, items_json, current_video_id, autoplay_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         items_json = excluded.items_json,
         current_video_id = excluded.current_video_id,
         autoplay_enabled = excluded.autoplay_enabled,
         updated_at = excluded.updated_at`
    )
    .run(
      profileId,
      JSON.stringify(normalized.items),
      normalized.currentVideoId,
      normalized.autoplayEnabled ? 1 : 0,
      now
    );

  return toSnapshot(normalized);
}

export function enqueueQueueVideos(profileId: string, videos: FeedVideo[]): QueueSnapshot {
  const state = getPlaybackQueue(profileId);
  return savePlaybackQueue(profileId, enqueueVideos(state, videos));
}

export function removeQueueVideo(profileId: string, videoId: string): QueueSnapshot {
  const state = getPlaybackQueue(profileId);
  return savePlaybackQueue(profileId, removeFromQueue(state, videoId));
}

export function reorderQueueVideo(profileId: string, videoId: string, toIndex: number): QueueSnapshot {
  const state = getPlaybackQueue(profileId);
  return savePlaybackQueue(profileId, reorderQueue(state, videoId, toIndex));
}

export function clearPlaybackQueue(profileId: string): QueueSnapshot {
  const state = getPlaybackQueue(profileId);
  return savePlaybackQueue(profileId, clearQueue(state));
}

export function setQueueCurrentVideo(profileId: string, videoId: string | null): QueueSnapshot {
  const state = getPlaybackQueue(profileId);
  return savePlaybackQueue(profileId, setCurrentVideo(state, videoId));
}

export function setQueueAutoplay(profileId: string, enabled: boolean): QueueSnapshot {
  const state = getPlaybackQueue(profileId);
  return savePlaybackQueue(profileId, setAutoplayEnabled(state, enabled));
}

export function advancePlaybackQueue(profileId: string): QueueTransition {
  const state = getPlaybackQueue(profileId);
  const transition = advanceQueue(state);
  savePlaybackQueue(profileId, transition.state);
  return transition;
}

export function handlePlaybackQueueEnded(profileId: string): QueueTransition {
  const state = getPlaybackQueue(profileId);
  const transition = handlePlaybackEnded(state);
  savePlaybackQueue(profileId, transition.state);
  return transition;
}

function assertQueueProfile(profileId: string) {
  if (!profileId || !getProfile(profileId)) {
    throw new Error("Profile not found.");
  }
}

function decodeQueue(row: {
  items_json: string;
  current_video_id: string | null;
  autoplay_enabled: number;
}): PlaybackQueueState {
  let items: FeedVideo[] = [];
  try {
    const parsed = JSON.parse(row.items_json);
    if (Array.isArray(parsed)) items = parsed as FeedVideo[];
  } catch {
    // A corrupt local queue is recoverable user state; reset it to an empty queue.
  }

  return createPlaybackQueue(items, {
    currentVideoId: row.current_video_id,
    autoplayEnabled: row.autoplay_enabled === 1
  });
}

function toSnapshot(state: PlaybackQueueState): QueueSnapshot {
  return {
    ...state,
    currentVideo: getCurrentVideo(state),
    upNextVideos: getUpNextVideos(state)
  };
}
