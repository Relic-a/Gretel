import { getDatabase } from "../profile-store";
import type { FeedNodeId, FeedVideo } from "./types";

export type FeedCacheState = {
  baseRefreshedAt: number;
  subscriptionRefreshedAt: number;
  cachedVideos: number;
};

export type CachedFeedVideo = FeedVideo & {
  recommendationCount: number;
  lastRecommendedAt: number;
};

type FeedCacheRow = {
  video_json: string;
  recommendation_count: number;
  last_recommended_at: number | null;
};

export function getFeedCacheState(profileId: string, cacheKey: string): FeedCacheState | null {
  const row = getDatabase()
    .prepare(
      `SELECT state.base_refreshed_at, state.subscription_refreshed_at, COUNT(videos.video_id) AS cached_videos
       FROM feed_cache_state state
       LEFT JOIN feed_cache_videos videos
         ON videos.profile_id = state.profile_id AND videos.cache_key = state.cache_key
       WHERE state.profile_id = ? AND state.cache_key = ?
       GROUP BY state.profile_id, state.cache_key`
    )
    .get(profileId, cacheKey) as
    | {
        base_refreshed_at: number;
        subscription_refreshed_at: number;
        cached_videos: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    baseRefreshedAt: row.base_refreshed_at,
    subscriptionRefreshedAt: row.subscription_refreshed_at,
    cachedVideos: row.cached_videos
  };
}

export function saveFeedCacheVideos(
  profileId: string,
  cacheKey: string,
  videosByNode: Partial<Record<FeedNodeId, FeedVideo[]>>,
  refreshedAt: number,
  refreshBase: boolean,
  refreshSubscriptions: boolean
) {
  const database = getDatabase();

  database
    .prepare(
      `INSERT INTO feed_cache_state (
        profile_id, cache_key, base_refreshed_at, subscription_refreshed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, cache_key) DO UPDATE SET
        base_refreshed_at = CASE
          WHEN ? THEN excluded.base_refreshed_at
          ELSE feed_cache_state.base_refreshed_at
        END,
        subscription_refreshed_at = CASE
          WHEN ? THEN excluded.subscription_refreshed_at
          ELSE feed_cache_state.subscription_refreshed_at
        END,
        updated_at = excluded.updated_at`
    )
    .run(
      profileId,
      cacheKey,
      refreshedAt,
      refreshSubscriptions ? refreshedAt : 0,
      refreshedAt,
      refreshedAt,
      refreshBase ? 1 : 0,
      refreshSubscriptions ? 1 : 0
    );

  const statement = database.prepare(
    `INSERT INTO feed_cache_videos (
      profile_id, cache_key, node_id, video_id, video_json, first_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, cache_key, node_id, video_id) DO UPDATE SET
      video_json = excluded.video_json,
      updated_at = excluded.updated_at`
  );

  for (const [nodeId, videos] of Object.entries(videosByNode) as Array<[FeedNodeId, FeedVideo[]]>) {
    for (const video of videos) {
      statement.run(
        profileId,
        cacheKey,
        nodeId,
        video.id,
        JSON.stringify(video),
        refreshedAt,
        refreshedAt
      );
    }
  }
}

export function getCachedFeedVideos(
  profileId: string,
  cacheKey: string,
  nodeId: FeedNodeId,
  limit: number
) {
  const rows = getDatabase()
    .prepare(
      `SELECT video_json, recommendation_count, last_recommended_at
       FROM feed_cache_videos
       WHERE profile_id = ? AND cache_key = ? AND node_id = ?
       ORDER BY recommendation_count ASC, COALESCE(last_recommended_at, 0) ASC, first_seen_at DESC
       LIMIT ?`
    )
    .all(profileId, cacheKey, nodeId, limit) as FeedCacheRow[];

  return rows.flatMap((row) => {
    try {
      const video = JSON.parse(row.video_json) as FeedVideo;
      return [
        {
          ...video,
          recommendationCount: row.recommendation_count,
          lastRecommendedAt: row.last_recommended_at || 0
        }
      ];
    } catch {
      return [];
    }
  });
}

export function markFeedVideosRecommended(profileId: string, cacheKey: string, videos: FeedVideo[]) {
  if (videos.length === 0) {
    return;
  }

  const database = getDatabase();
  const updatedAt = Date.now();
  const statement = database.prepare(
    `UPDATE feed_cache_videos
     SET recommendation_count = recommendation_count + 1,
         last_recommended_at = ?,
         updated_at = ?
     WHERE profile_id = ? AND cache_key = ? AND video_id = ?`
  );

  for (const video of videos) {
    statement.run(updatedAt, updatedAt, profileId, cacheKey, video.id);
  }
}

export function createFeedCacheKey(input: {
  tags: string[];
  channels: string[];
  channelSort: string;
  latestWatchedVideoIds: string[];
}) {
  return JSON.stringify({
    tags: input.tags.map(normalizeCachePart).sort(),
    channels: input.channels.map(normalizeCachePart).sort(),
    channelSort: input.channelSort,
    latestWatchedVideoIds: input.latestWatchedVideoIds
  });
}

function normalizeCachePart(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
