import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getGretelConfig } from "./feed/config";
import type { FeedNodeId, FeedVideo } from "./feed/types";
import { forgetYoutubeClient } from "./feed/youtube-client";

export type GretelProfile = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type WatchEventInput = {
  profileId: string;
  video: FeedVideo;
  watchedSeconds: number;
  durationSeconds: number;
};

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "gretel.sqlite");
let db: DatabaseSync | null = null;

export function getDatabase() {
  if (!db) {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watched_videos (
        profile_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        duration TEXT NOT NULL,
        query TEXT NOT NULL,
        source_node_id TEXT,
        source_node_label TEXT,
        channel_key TEXT,
        watched_seconds REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        watched_ratio REAL NOT NULL,
        watched_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, video_id),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS node_affinity (
        profile_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        boost REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, node_id),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS channel_affinity (
        profile_id TEXT NOT NULL,
        channel_key TEXT NOT NULL,
        boost REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, channel_key),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS feed_cache_state (
        profile_id TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        base_refreshed_at INTEGER NOT NULL,
        subscription_refreshed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, cache_key),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS feed_cache_videos (
        profile_id TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        node_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_json TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        recommendation_count INTEGER NOT NULL DEFAULT 0,
        last_recommended_at INTEGER,
        PRIMARY KEY (profile_id, cache_key, node_id, video_id),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );
    `);
    ensureDefaultProfile();
  }

  return db;
}

export function listProfiles() {
  const rows = getDatabase()
    .prepare("SELECT id, name, created_at, updated_at FROM profiles ORDER BY created_at ASC")
    .all() as Array<Record<string, number | string>>;

  return rows.map(toProfile);
}

export function getProfile(profileId: string) {
  const row = getDatabase()
    .prepare("SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?")
    .get(profileId) as Record<string, number | string> | undefined;

  return row ? toProfile(row) : null;
}

export function createProfile(name: string) {
  const now = Date.now();
  const profile: GretelProfile = {
    id: crypto.randomUUID(),
    name: cleanProfileName(name),
    createdAt: now,
    updatedAt: now
  };

  getDatabase()
    .prepare("INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(profile.id, profile.name, profile.createdAt, profile.updatedAt);

  return profile;
}

export function deleteProfile(profileId: string) {
  const profiles = listProfiles();

  if (profiles.length <= 1) {
    resetProfile(profileId);
    return listProfiles()[0];
  }

  getDatabase().prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
  resetYoutubeProfileCache(profileId);
  return listProfiles()[0];
}

export function resetProfile(profileId: string) {
  const database = getDatabase();
  database.prepare("DELETE FROM watched_videos WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM node_affinity WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM channel_affinity WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM feed_cache_state WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM feed_cache_videos WHERE profile_id = ?").run(profileId);
  database.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(Date.now(), profileId);
  resetYoutubeProfileCache(profileId);
}

export function saveWatchedVideo(input: WatchEventInput) {
  const watchedRatio = input.durationSeconds > 0 ? input.watchedSeconds / input.durationSeconds : 0;
  const config = getGretelConfig();

  if (watchedRatio <= config.learning.watchSaveThreshold || !getProfile(input.profileId)) {
    return false;
  }

  const watchedAt = Date.now();
  const channelKey = input.video.channelKey || normalizeChannelKey(input.video.author);
  const sourceNodeId = input.video.sourceNodeId || null;
  const sourceNodeLabel = input.video.sourceNodeLabel || null;
  const database = getDatabase();

  database
    .prepare(
      `INSERT INTO watched_videos (
        profile_id, video_id, title, author, duration, query, source_node_id,
        source_node_label, channel_key, watched_seconds, duration_seconds,
        watched_ratio, watched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, video_id) DO UPDATE SET
        watched_seconds = MAX(watched_seconds, excluded.watched_seconds),
        duration_seconds = excluded.duration_seconds,
        watched_ratio = MAX(watched_ratio, excluded.watched_ratio),
        watched_at = excluded.watched_at`
    )
    .run(
      input.profileId,
      input.video.id,
      input.video.title,
      input.video.author,
      input.video.duration,
      input.video.query,
      sourceNodeId,
      sourceNodeLabel,
      channelKey,
      input.watchedSeconds,
      input.durationSeconds,
      watchedRatio,
      watchedAt
    );

  if (sourceNodeId) {
    bumpNodeAffinity(input.profileId, sourceNodeId as FeedNodeId, watchedAt);
  }

  if (channelKey) {
    bumpChannelAffinity(input.profileId, channelKey, watchedAt);
  }

  database.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(watchedAt, input.profileId);
  return true;
}

export function getWatchedVideoIds(profileId: string) {
  const rows = getDatabase()
    .prepare("SELECT video_id FROM watched_videos WHERE profile_id = ?")
    .all(profileId) as Array<{ video_id: string }>;

  return rows.map((row) => row.video_id);
}

export function getLatestWatchedVideos(profileId: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT video_id, title, author, duration, query, source_node_id, source_node_label, channel_key
       FROM watched_videos
       WHERE profile_id = ?
       ORDER BY watched_at DESC
       LIMIT ?`
    )
    .all(profileId, getGretelConfig().feed.watchedRecommendationSeeds) as Array<
      Record<string, string | null>
    >;

  return rows.map<FeedVideo>((row) => ({
    id: row.video_id || "",
    title: row.title || "Watched video",
    author: row.author || "Unknown channel",
    duration: row.duration || "",
    query: row.query || "Watched",
    sourceNodeId: (row.source_node_id as FeedNodeId | null) || undefined,
    sourceNodeLabel: row.source_node_label || undefined,
    channelKey: row.channel_key || undefined
  }));
}

export function getNodeBoosts(profileId: string) {
  const rows = getDatabase()
    .prepare("SELECT node_id, boost FROM node_affinity WHERE profile_id = ?")
    .all(profileId) as Array<{ node_id: FeedNodeId; boost: number }>;

  return Object.fromEntries(rows.map((row) => [row.node_id, row.boost])) as Partial<
    Record<FeedNodeId, number>
  >;
}

export function getChannelBoosts(profileId: string) {
  const rows = getDatabase()
    .prepare("SELECT channel_key, boost FROM channel_affinity WHERE profile_id = ?")
    .all(profileId) as Array<{ channel_key: string; boost: number }>;

  return Object.fromEntries(rows.map((row) => [row.channel_key, row.boost]));
}

export function normalizeChannelKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function ensureDefaultProfile() {
  const count = getDatabase().prepare("SELECT COUNT(*) AS count FROM profiles").get() as {
    count: number;
  };

  if (count.count === 0) {
    createProfile("Default");
  }
}

function bumpNodeAffinity(profileId: string, nodeId: FeedNodeId, updatedAt: number) {
  const config = getGretelConfig();

  getDatabase()
    .prepare(
      `INSERT INTO node_affinity (profile_id, node_id, boost, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, node_id) DO UPDATE SET
         boost = MIN(?, boost + ?),
         updated_at = excluded.updated_at`
    )
    .run(
      profileId,
      nodeId,
      config.learning.nodeAffinityStep,
      updatedAt,
      config.learning.maxAffinityBoost,
      config.learning.nodeAffinityStep
    );
}

function bumpChannelAffinity(profileId: string, channelKey: string, updatedAt: number) {
  const config = getGretelConfig();

  getDatabase()
    .prepare(
      `INSERT INTO channel_affinity (profile_id, channel_key, boost, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, channel_key) DO UPDATE SET
         boost = MIN(?, boost + ?),
         updated_at = excluded.updated_at`
    )
    .run(
      profileId,
      channelKey,
      config.learning.channelAffinityStep,
      updatedAt,
      config.learning.maxAffinityBoost,
      config.learning.channelAffinityStep
    );
}

function cleanProfileName(name: string) {
  const cleaned = name.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "New profile";
}

function resetYoutubeProfileCache(profileId: string) {
  forgetYoutubeClient(profileId);
  rmSync(path.join(dataDir, "youtube-sessions", profileId), { recursive: true, force: true });
}

function toProfile(row: Record<string, number | string>): GretelProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}
