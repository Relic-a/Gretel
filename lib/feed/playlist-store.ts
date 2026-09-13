import { getDatabase } from "../profile-store";
import type { FeedVideo } from "./types";

export type PendingPlaylist = {
  profileId: string;
  poolKey: string;
  playlist: FeedVideo;
  discoveredAt: number;
};

let tablesReady = false;

function ensureTables() {
  if (tablesReady) return;
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS feed_playlists (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      playlist_id TEXT NOT NULL,
      playlist_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      discovered_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, pool_key, playlist_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS playlist_video_eligibility (
      profile_id TEXT NOT NULL,
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      centroid_eligible INTEGER NOT NULL,
      PRIMARY KEY (profile_id, playlist_id, video_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
  `);
  tablesReady = true;
}

export function rememberPlaylistCandidates(
  profileId: string,
  poolKey: string,
  playlists: FeedVideo[],
  discoveredAt: number
) {
  if (playlists.length === 0) return;
  ensureTables();
  const statement = getDatabase().prepare(`
    INSERT INTO feed_playlists (
      profile_id, pool_key, playlist_id, playlist_json, status, discovered_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(profile_id, pool_key, playlist_id) DO NOTHING
  `);
  for (const playlist of playlists) {
    statement.run(profileId, poolKey, playlist.id, JSON.stringify(playlist), discoveredAt, Date.now());
  }
}

export function listPendingPlaylists(profileId: string, poolKey: string): PendingPlaylist[] {
  ensureTables();
  const rows = getDatabase().prepare(`
    SELECT playlist_json, discovered_at FROM feed_playlists
    WHERE profile_id = ? AND pool_key = ? AND status = 'pending'
    ORDER BY discovered_at ASC, playlist_id ASC
  `).all(profileId, poolKey) as Array<{ playlist_json: string; discovered_at: number }>;
  return rows.flatMap((row) => {
    try {
      return [{ profileId, poolKey, playlist: JSON.parse(row.playlist_json) as FeedVideo, discoveredAt: row.discovered_at }];
    } catch {
      return [];
    }
  });
}

export function setPlaylistDecision(
  profileId: string,
  poolKey: string,
  playlist: FeedVideo,
  admitted: boolean
) {
  ensureTables();
  getDatabase().prepare(`
    UPDATE feed_playlists SET playlist_json = ?, status = ?, updated_at = ?
    WHERE profile_id = ? AND pool_key = ? AND playlist_id = ?
  `).run(JSON.stringify(playlist), admitted ? "admitted" : "rejected", Date.now(), profileId, poolKey, playlist.id);
}

export function isPlaylistAdmitted(profileId: string, poolKey: string, playlistId: string) {
  ensureTables();
  const row = getDatabase().prepare(`
    SELECT status FROM feed_playlists
    WHERE profile_id = ? AND pool_key = ? AND playlist_id = ?
  `).get(profileId, poolKey, playlistId) as { status: string } | undefined;
  return row?.status === "admitted";
}

export function getAdmittedPlaylist(profileId: string, poolKey: string, playlistId: string): FeedVideo | null {
  ensureTables();
  const row = getDatabase().prepare(`
    SELECT playlist_json FROM feed_playlists
    WHERE profile_id = ? AND pool_key = ? AND playlist_id = ? AND status = 'admitted'
  `).get(profileId, poolKey, playlistId) as { playlist_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.playlist_json) as FeedVideo;
  } catch {
    return null;
  }
}

export function rememberPlaylistVideoEligibility(
  profileId: string,
  playlistId: string,
  videos: FeedVideo[]
) {
  ensureTables();
  const statement = getDatabase().prepare(`
    INSERT INTO playlist_video_eligibility (profile_id, playlist_id, video_id, centroid_eligible)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id, playlist_id, video_id) DO UPDATE SET
      centroid_eligible = excluded.centroid_eligible
  `);
  for (const video of videos) statement.run(profileId, playlistId, video.id, video.centroidEligible === false ? 0 : 1);
}

export function isPlaylistVideoCentroidEligible(profileId: string, videoId: string) {
  ensureTables();
  const row = getDatabase().prepare(`
    SELECT MIN(centroid_eligible) AS eligible FROM playlist_video_eligibility
    WHERE profile_id = ? AND video_id = ?
  `).get(profileId, videoId) as { eligible: number | null } | undefined;
  return row?.eligible !== 0;
}
