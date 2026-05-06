import { getDatabase, getLikedVideoIds, getWatchedVideoIds } from "../profile-store";
import { deleteRetainedEmbeddings } from "./algorithm-store";
import type { FeedNodeId, FeedVideo } from "./types";

export type FeedPoolState = {
  rootDiscoveredAt: number;
  updatedAt: number;
  poolVideos: number;
};

export type StoredPoolNode = FeedVideo & {
  poolNodeId: FeedNodeId;
  firstSeenAt: number;
  lastServedAt: number;
  servedCount: number;
};

export function createFeedPoolKey(input: {
  tags: string[];
  channels: string[];
  channelSort: string;
}) {
  return JSON.stringify({
    tags: input.tags.map(normalizePoolKeyPart).sort(),
    channels: input.channels.map(normalizePoolKeyPart).sort(),
    channelSort: input.channelSort
  });
}

export function ensureFeedPoolTables() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS feed_pool_state (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      root_discovered_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, pool_key),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feed_pool_nodes (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      video_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      video_json TEXT NOT NULL,
      parent_video_id TEXT,
      origin_tag TEXT,
      similarity_score REAL NOT NULL,
      parent_engagement_score REAL NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      served_count INTEGER NOT NULL DEFAULT 0,
      last_served_at INTEGER,
      PRIMARY KEY (profile_id, pool_key, video_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feed_visited_videos (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      video_id TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, pool_key, video_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
  `);

  try {
    getDatabase().exec(`ALTER TABLE feed_pool_nodes ADD COLUMN origin_tag TEXT;`);
  } catch {
    // Column already exists
  }
}

export function getFeedPoolState(profileId: string, poolKey: string): FeedPoolState | null {
  ensureFeedPoolTables();
  const row = getDatabase()
    .prepare(
      `SELECT state.root_discovered_at, state.updated_at, COUNT(nodes.video_id) AS pool_videos
       FROM feed_pool_state state
       LEFT JOIN feed_pool_nodes nodes
         ON nodes.profile_id = state.profile_id AND nodes.pool_key = state.pool_key
       WHERE state.profile_id = ? AND state.pool_key = ?
       GROUP BY state.profile_id, state.pool_key`
    )
    .get(profileId, poolKey) as
    | {
        root_discovered_at: number;
        updated_at: number;
        pool_videos: number;
      }
    | undefined;

  return row
    ? {
        rootDiscoveredAt: row.root_discovered_at,
        updatedAt: row.updated_at,
        poolVideos: row.pool_videos
      }
    : null;
}

export function markRootDiscovered(profileId: string, poolKey: string, timestamp: number) {
  ensureFeedPoolTables();
  getDatabase()
    .prepare(
      `INSERT INTO feed_pool_state (profile_id, pool_key, root_discovered_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, pool_key) DO UPDATE SET
         updated_at = excluded.updated_at`
    )
    .run(profileId, poolKey, timestamp, timestamp);
}

export function addPoolNodes(
  profileId: string,
  poolKey: string,
  nodeId: FeedNodeId,
  videos: FeedVideo[],
  timestamp: number
) {
  ensureFeedPoolTables();
  const statement = getDatabase().prepare(
    `INSERT INTO feed_pool_nodes (
      profile_id, pool_key, video_id, node_id, video_json, parent_video_id, origin_tag,
      similarity_score, parent_engagement_score, first_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, pool_key, video_id) DO NOTHING`
  );
  const visitedStatement = getDatabase().prepare(
    `INSERT INTO feed_visited_videos (profile_id, pool_key, video_id, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, pool_key, video_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at`
  );

  for (const video of videos) {
    statement.run(
      profileId,
      poolKey,
      video.id,
      nodeId,
      JSON.stringify({ ...video, sourceNodeId: nodeId }),
      video.parent_video_id || null,
      video.originTag || null,
      video.similarityScore || 0,
      video.parentEngagementScore || 0,
      timestamp,
      timestamp
    );
    visitedStatement.run(profileId, poolKey, video.id, timestamp, timestamp);
  }

  touchPool(profileId, poolKey, timestamp);
}

export function listPoolNodes(profileId: string, poolKey: string) {
  ensureFeedPoolTables();
  const rows = getDatabase()
    .prepare(
      `SELECT node_id, video_json, similarity_score, parent_engagement_score,
              first_seen_at, COALESCE(last_served_at, 0) AS last_served_at, served_count
       FROM feed_pool_nodes
       WHERE profile_id = ? AND pool_key = ?
       ORDER BY first_seen_at ASC`
    )
    .all(profileId, poolKey) as Array<{
      node_id: FeedNodeId;
      video_json: string;
      similarity_score: number;
      parent_engagement_score: number;
      first_seen_at: number;
      last_served_at: number;
      served_count: number;
    }>;

  return rows.flatMap<StoredPoolNode>((row) => {
    try {
      const video = JSON.parse(row.video_json) as FeedVideo;

      return [{
        ...video,
        sourceNodeId: row.node_id,
        similarityScore: row.similarity_score,
        parentEngagementScore: row.parent_engagement_score,
        poolNodeId: row.node_id,
        firstSeenAt: row.first_seen_at,
        lastServedAt: row.last_served_at,
        servedCount: row.served_count
      }];
    } catch {
      return [];
    }
  });
}

export function getPoolVideoIds(profileId: string, poolKey: string) {
  ensureFeedPoolTables();
  const rows = getDatabase()
    .prepare("SELECT video_id FROM feed_pool_nodes WHERE profile_id = ? AND pool_key = ?")
    .all(profileId, poolKey) as Array<{ video_id: string }>;

  return new Set(rows.map((row) => row.video_id));
}

export function getVisitedVideoIds(profileId: string, poolKey: string) {
  ensureFeedPoolTables();
  const rows = getDatabase()
    .prepare("SELECT video_id FROM feed_visited_videos WHERE profile_id = ? AND pool_key = ?")
    .all(profileId, poolKey) as Array<{ video_id: string }>;
  const videoIds = new Set(rows.map((row) => row.video_id));

  for (const videoId of getPoolVideoIds(profileId, poolKey)) {
    videoIds.add(videoId);
  }

  for (const videoId of getWatchedVideoIds(profileId)) {
    videoIds.add(videoId);
  }

  return videoIds;
}

export function markPoolNodesServed(profileId: string, poolKey: string, videos: FeedVideo[]) {
  if (videos.length === 0) {
    return;
  }

  const timestamp = Date.now();
  const statement = getDatabase().prepare(
    `UPDATE feed_pool_nodes
     SET served_count = served_count + 1,
         last_served_at = ?,
         updated_at = ?
     WHERE profile_id = ? AND pool_key = ? AND video_id = ?`
  );

  for (const video of videos) {
    statement.run(timestamp, timestamp, profileId, poolKey, video.id);
  }
}

export function updatePoolSimilarities(profileId: string, poolKey: string, videos: FeedVideo[]) {
  if (videos.length === 0) {
    return;
  }

  const timestamp = Date.now();
  const statement = getDatabase().prepare(
    `UPDATE feed_pool_nodes
     SET similarity_score = ?, video_json = ?, updated_at = ?
     WHERE profile_id = ? AND pool_key = ? AND video_id = ?`
  );

  for (const video of videos) {
    statement.run(
      video.similarityScore || 0,
      JSON.stringify(video),
      timestamp,
      profileId,
      poolKey,
      video.id
    );
  }
}

export function prunePool(profileId: string, poolKey: string, scoredVideos: FeedVideo[], maxPoolVideos: number) {
  const excess = scoredVideos.length - maxPoolVideos;

  if (excess <= 0) {
    return [];
  }

  const sorted = [...scoredVideos].sort(
    (left, right) =>
      (left.engagementScore || 0) - (right.engagementScore || 0) ||
      (left.similarityScore || 0) - (right.similarityScore || 0)
  );
  const statement = getDatabase().prepare(
    "DELETE FROM feed_pool_nodes WHERE profile_id = ? AND pool_key = ? AND video_id = ?"
  );

  const prunedVideos = sorted.slice(0, excess);
  const retainedVideoIds = new Set([
    ...getWatchedVideoIds(profileId),
    ...getLikedVideoIds(profileId)
  ]);

  for (const video of prunedVideos) {
    statement.run(profileId, poolKey, video.id);
  }

  deleteRetainedEmbeddings(
    profileId,
    prunedVideos
      .map((video) => video.id)
      .filter((videoId) => !retainedVideoIds.has(videoId))
  );

  return prunedVideos;
}

export function deleteFeedPoolData(profileId: string) {
  ensureFeedPoolTables();
  getDatabase().prepare("DELETE FROM feed_pool_state WHERE profile_id = ?").run(profileId);
  getDatabase().prepare("DELETE FROM feed_pool_nodes WHERE profile_id = ?").run(profileId);
  getDatabase().prepare("DELETE FROM feed_visited_videos WHERE profile_id = ?").run(profileId);
}

function touchPool(profileId: string, poolKey: string, timestamp: number) {
  getDatabase()
    .prepare(
      `UPDATE feed_pool_state
       SET updated_at = ?
       WHERE profile_id = ? AND pool_key = ?`
    )
    .run(timestamp, profileId, poolKey);
}

function normalizePoolKeyPart(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
