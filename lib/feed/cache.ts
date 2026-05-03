import { existsSync, mkdirSync, rmSync, writeFile } from "node:fs";
import path from "node:path";

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
  refreshSubscriptions: boolean,
  maxCachedVideos: number
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
  const existingRows = database
    .prepare(
      `SELECT node_id, video_id
       FROM feed_cache_videos
       WHERE profile_id = ? AND cache_key = ?`
    )
    .all(profileId, cacheKey) as Array<{ node_id: FeedNodeId; video_id: string }>;
  const admittedNodeByVideoId = new Map(existingRows.map((row) => [row.video_id, row.node_id]));

  for (const [nodeId, videos] of Object.entries(videosByNode) as Array<[FeedNodeId, FeedVideo[]]>) {
    for (const video of videos) {
      const admittedNodeId = admittedNodeByVideoId.get(video.id);

      if (admittedNodeId && admittedNodeId !== nodeId) {
        continue;
      }

      admittedNodeByVideoId.set(video.id, nodeId);
      statement.run(
        profileId,
        cacheKey,
        nodeId,
        video.id,
        JSON.stringify(video),
        refreshedAt,
        refreshedAt
      );

      if (video.thumbnailUrl) {
        void cacheThumbnail(profileId, video);
      }
    }
  }

  pruneFeedCacheVideos(profileId, cacheKey, maxCachedVideos);
}

export function getCachedThumbnailPath(profileId: string, videoId: string) {
  return path.join(thumbnailDirectory(profileId), `${cleanFilePart(videoId)}.jpg`);
}

export function getCachedFeedVideos(
  profileId: string,
  cacheKey: string,
  nodeId: FeedNodeId,
  limit: number,
  watchedVideoIds: string[] = []
) {
  const watchedFilter =
    watchedVideoIds.length > 0
      ? `AND video_id NOT IN (${watchedVideoIds.map(() => "?").join(", ")})`
      : "";
  const params = [profileId, cacheKey, nodeId, ...watchedVideoIds, limit];
  const rows = getDatabase()
    .prepare(
      `SELECT video_json, recommendation_count, last_recommended_at
       FROM feed_cache_videos
       WHERE profile_id = ? AND cache_key = ? AND node_id = ?
       ${watchedFilter}
       ORDER BY recommendation_count ASC, COALESCE(last_recommended_at, 0) ASC, first_seen_at DESC
       LIMIT ?`
    )
    .all(...params) as FeedCacheRow[];

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
}) {
  return JSON.stringify({
    tags: input.tags.map(normalizeCachePart).sort(),
    channels: input.channels.map(normalizeCachePart).sort(),
    channelSort: input.channelSort
  });
}

function normalizeCachePart(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function pruneFeedCacheVideos(profileId: string, cacheKey: string, maxCachedVideos: number) {
  const database = getDatabase();
  let row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM feed_cache_videos
       WHERE profile_id = ? AND cache_key = ?`
    )
    .get(profileId, cacheKey) as { count: number };

  if (row.count <= maxCachedVideos) {
    return;
  }

  const deleteStatement = database.prepare(
    `DELETE FROM feed_cache_videos
     WHERE rowid IN (
       SELECT rowid
       FROM feed_cache_videos
       WHERE profile_id = ? AND cache_key = ?
       ORDER BY CAST(json_extract(video_json, '$.engagementScore') AS REAL) ASC,
                CAST(json_extract(video_json, '$.similarityScore') AS REAL) ASC,
                recommendation_count DESC,
                COALESCE(last_recommended_at, 0) DESC,
                first_seen_at ASC
       LIMIT 1
     )`
  );

  while (row.count > maxCachedVideos) {
    const deleted = database
      .prepare(
        `SELECT video_id
         FROM feed_cache_videos
         WHERE profile_id = ? AND cache_key = ?
         ORDER BY CAST(json_extract(video_json, '$.engagementScore') AS REAL) ASC,
                  CAST(json_extract(video_json, '$.similarityScore') AS REAL) ASC,
                  recommendation_count DESC,
                  COALESCE(last_recommended_at, 0) DESC,
                  first_seen_at ASC
         LIMIT 1`
      )
      .get(profileId, cacheKey) as { video_id: string } | undefined;

    deleteStatement.run(profileId, cacheKey);

    if (deleted) {
      removeThumbnailIfUnused(profileId, deleted.video_id);
    }

    row = { count: row.count - 1 };
  }
}

async function cacheThumbnail(profileId: string, video: FeedVideo) {
  const videoId = cleanFilePart(video.id);
  const thumbnailUrl = video.thumbnailUrl;

  if (!videoId || !thumbnailUrl) {
    return;
  }

  const filePath = getCachedThumbnailPath(profileId, videoId);

  if (existsSync(filePath)) {
    return;
  }

  try {
    const response = await fetch(thumbnailUrl);

    if (!response.ok) {
      return;
    }

    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFile(filePath, Buffer.from(await response.arrayBuffer()), () => {});
  } catch {
    // Thumbnail caching is opportunistic; the UI can still use YouTube's URL.
  }
}

function removeThumbnailIfUnused(profileId: string, videoId: string) {
  const remaining = getDatabase()
    .prepare("SELECT 1 FROM feed_cache_videos WHERE profile_id = ? AND video_id = ? LIMIT 1")
    .get(profileId, videoId);

  if (!remaining) {
    rmSync(getCachedThumbnailPath(profileId, videoId), { force: true });
  }
}

function thumbnailDirectory(profileId: string) {
  return path.join(process.cwd(), "data", "thumbnails", cleanFilePart(profileId));
}

function cleanFilePart(value: string) {
  return value.replace(/[^a-z0-9._-]/gi, "_");
}
