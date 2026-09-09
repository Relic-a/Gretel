import type Database from "better-sqlite3";

import type { FeedVideo } from "./feed/types";

export const DEFAULT_SAVED_FOLDERS = ["Watch Later", "Research", "Reference"] as const;

export type SavedCollection = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type SavedItem = {
  video: FeedVideo;
  savedAt: number;
  updatedAt: number;
  note: string;
  folders: SavedCollection[];
  tags: SavedCollection[];
};

export type SavedItemFilters = {
  query?: string;
  folderId?: string;
  tagId?: string;
};

export type SavedItemUpdate = {
  note?: string;
  folderIds?: string[];
  tagIds?: string[];
};

type CollectionKind = "folder" | "tag";
type CollectionRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};
type SavedItemRow = {
  profile_id: string;
  video_id: string;
  video_json: string;
  saved_at: number;
  updated_at: number;
  note: string;
};

/**
 * Creates the saved-collection tables and performs the idempotent migration
 * from the original saved_videos table. The function intentionally accepts a
 * database instance so profile-store can initialize it without a module cycle.
 */
export function initializeSavedCollectionSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS saved_items (
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_json TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (profile_id, video_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_folders (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (profile_id, normalized_name),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_tags (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (profile_id, normalized_name),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_item_folders (
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, video_id, folder_id),
      FOREIGN KEY (profile_id, video_id) REFERENCES saved_items(profile_id, video_id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES saved_folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_item_tags (
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, video_id, tag_id),
      FOREIGN KEY (profile_id, video_id) REFERENCES saved_items(profile_id, video_id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES saved_tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS saved_items_profile_saved_at_idx
      ON saved_items(profile_id, saved_at DESC);
    CREATE INDEX IF NOT EXISTS saved_item_folders_folder_idx
      ON saved_item_folders(profile_id, folder_id, video_id);
    CREATE INDEX IF NOT EXISTS saved_item_tags_tag_idx
      ON saved_item_tags(profile_id, tag_id, video_id);
  `);

  const profiles = database.prepare("SELECT id FROM profiles").all() as Array<{ id: string }>;
  const migrate = database.transaction(() => {
    for (const profile of profiles) {
      ensureDefaultFolders(database, profile.id);
      migrateLegacyItems(database, profile.id);
    }
  });
  migrate();
}

export function ensureDefaultFolders(database: Database.Database, profileId: string, now = Date.now()) {
  const statement = database.prepare(
    `INSERT INTO saved_folders (id, profile_id, name, normalized_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, normalized_name) DO NOTHING`
  );

  for (const name of DEFAULT_SAVED_FOLDERS) {
    statement.run(crypto.randomUUID(), profileId, name, normalizeCollectionName(name), now, now);
  }
}

function migrateLegacyItems(database: Database.Database, profileId: string) {
  const watchLater = database
    .prepare("SELECT id FROM saved_folders WHERE profile_id = ? AND normalized_name = ?")
    .get(profileId, normalizeCollectionName("Watch Later")) as { id: string } | undefined;

  if (!watchLater) {
    return;
  }

  const legacyRows = database
    .prepare("SELECT video_id, video_json, saved_at FROM saved_videos WHERE profile_id = ?")
    .all(profileId) as Array<{ video_id: string; video_json: string; saved_at: number }>;
  const insertItem = database.prepare(
    `INSERT INTO saved_items (profile_id, video_id, video_json, saved_at, updated_at, note)
     VALUES (?, ?, ?, ?, ?, '')
     ON CONFLICT(profile_id, video_id) DO NOTHING`
  );
  const insertFolder = database.prepare(
    `INSERT INTO saved_item_folders (profile_id, video_id, folder_id)
     VALUES (?, ?, ?)
     ON CONFLICT(profile_id, video_id, folder_id) DO NOTHING`
  );

  for (const row of legacyRows) {
    insertItem.run(profileId, row.video_id, row.video_json, row.saved_at, row.saved_at);
    insertFolder.run(profileId, row.video_id, watchLater.id);
  }
}

export function listSavedFolders(database: Database.Database, profileId: string) {
  return listCollections(database, profileId, "folder");
}

export function listSavedTags(database: Database.Database, profileId: string) {
  return listCollections(database, profileId, "tag");
}

function listCollections(database: Database.Database, profileId: string, kind: CollectionKind): SavedCollection[] {
  const table = kind === "folder" ? "saved_folders" : "saved_tags";
  const rows = database
    .prepare(`SELECT id, name, created_at, updated_at FROM ${table} WHERE profile_id = ?
      ORDER BY CASE normalized_name
        WHEN 'watch later' THEN 0
        WHEN 'research' THEN 1
        WHEN 'reference' THEN 2
        ELSE 3
      END, created_at ASC, name ASC`)
    .all(profileId) as CollectionRow[];

  return rows.map(toCollection);
}

export function createSavedFolder(database: Database.Database, profileId: string, name: string, now = Date.now()) {
  const collection = createCollection(database, profileId, name, "folder", now);
  touchProfile(database, profileId, now);
  return collection;
}

export function createSavedTag(database: Database.Database, profileId: string, name: string, now = Date.now()) {
  const collection = createCollection(database, profileId, name, "tag", now);
  touchProfile(database, profileId, now);
  return collection;
}

function createCollection(database: Database.Database, profileId: string, name: string, kind: CollectionKind, now: number) {
  const cleanedName = cleanCollectionName(name);
  if (!cleanedName) {
    throw new Error(`${kind === "folder" ? "Folder" : "Tag"} name is required.`);
  }

  const table = kind === "folder" ? "saved_folders" : "saved_tags";
  const id = crypto.randomUUID();
  try {
    database
      .prepare(
        `INSERT INTO ${table} (id, profile_id, name, normalized_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, profileId, cleanedName, normalizeCollectionName(cleanedName), now, now);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new Error(`${kind === "folder" ? "Folder" : "Tag"} already exists.`);
    }
    throw error;
  }

  return { id, name: cleanedName, createdAt: now, updatedAt: now } satisfies SavedCollection;
}

export function renameSavedFolder(database: Database.Database, profileId: string, folderId: string, name: string, now = Date.now()) {
  return renameCollection(database, profileId, folderId, name, "folder", now);
}

export function renameSavedTag(database: Database.Database, profileId: string, tagId: string, name: string, now = Date.now()) {
  return renameCollection(database, profileId, tagId, name, "tag", now);
}

function renameCollection(database: Database.Database, profileId: string, id: string, name: string, kind: CollectionKind, now: number) {
  const cleanedName = cleanCollectionName(name);
  if (!cleanedName) {
    throw new Error(`${kind === "folder" ? "Folder" : "Tag"} name is required.`);
  }

  const table = kind === "folder" ? "saved_folders" : "saved_tags";
  try {
    const result = database
      .prepare(`UPDATE ${table} SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ? AND profile_id = ?`)
      .run(cleanedName, normalizeCollectionName(cleanedName), now, id, profileId);
    if (result.changes === 0) {
      throw new Error(`${kind === "folder" ? "Folder" : "Tag"} not found.`);
    }
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new Error(`${kind === "folder" ? "Folder" : "Tag"} already exists.`);
    }
    throw error;
  }

  const collection = getCollection(database, profileId, id, kind);
  touchProfile(database, profileId, now);
  return collection;
}

export function deleteSavedFolder(database: Database.Database, profileId: string, folderId: string) {
  return deleteCollection(database, profileId, folderId, "folder");
}

export function deleteSavedTag(database: Database.Database, profileId: string, tagId: string) {
  return deleteCollection(database, profileId, tagId, "tag");
}

function deleteCollection(database: Database.Database, profileId: string, id: string, kind: CollectionKind) {
  const table = kind === "folder" ? "saved_folders" : "saved_tags";
  const result = database.prepare(`DELETE FROM ${table} WHERE id = ? AND profile_id = ?`).run(id, profileId);
  if (result.changes === 0) {
    throw new Error(`${kind === "folder" ? "Folder" : "Tag"} not found.`);
  }
  touchProfile(database, profileId, Date.now());
  return true;
}

export function saveSavedItem(
  database: Database.Database,
  profileId: string,
  video: FeedVideo,
  options: SavedItemUpdate = {},
  now = Date.now()
) {
  const note = options.note === undefined ? "" : cleanNote(options.note);
  ensureDefaultFolders(database, profileId, now);

  database
    .prepare(
      `INSERT INTO saved_items (profile_id, video_id, video_json, saved_at, updated_at, note)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, video_id) DO UPDATE SET
         video_json = excluded.video_json,
         updated_at = excluded.updated_at,
         note = CASE WHEN excluded.note = '' THEN saved_items.note ELSE excluded.note END`
    )
    .run(profileId, video.id, JSON.stringify(video), now, now, note);
  database
    .prepare(
      `INSERT INTO saved_videos (profile_id, video_id, video_json, saved_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, video_id) DO UPDATE SET
         video_json = excluded.video_json,
         saved_at = excluded.saved_at`
    )
    .run(profileId, video.id, JSON.stringify(video), now);

  if (options.folderIds !== undefined || options.tagIds !== undefined) {
    updateSavedItemCollections(database, profileId, video.id, options.folderIds, options.tagIds);
  } else {
    const hasFolder = database
      .prepare("SELECT 1 FROM saved_item_folders WHERE profile_id = ? AND video_id = ? LIMIT 1")
      .get(profileId, video.id);
    if (!hasFolder) {
      addItemToDefaultFolder(database, profileId, video.id);
    }
  }

  touchProfile(database, profileId, now);
  return getSavedItem(database, profileId, video.id);
}

export function updateSavedItem(database: Database.Database, profileId: string, videoId: string, update: SavedItemUpdate, now = Date.now()) {
  const item = getSavedItem(database, profileId, videoId);
  if (!item) {
    throw new Error("Saved item not found.");
  }

  database.transaction(() => {
    if (update.note !== undefined) {
      database.prepare("UPDATE saved_items SET note = ?, updated_at = ? WHERE profile_id = ? AND video_id = ?")
        .run(cleanNote(update.note), now, profileId, videoId);
    }
    updateSavedItemCollections(database, profileId, videoId, update.folderIds, update.tagIds);
  })();
  touchProfile(database, profileId, now);
  return getSavedItem(database, profileId, videoId);
}

function updateSavedItemCollections(database: Database.Database, profileId: string, videoId: string, folderIds?: string[], tagIds?: string[]) {
  if (folderIds !== undefined) {
    const uniqueFolderIds = validateCollectionIds(database, profileId, folderIds, "folder");
    database.prepare("DELETE FROM saved_item_folders WHERE profile_id = ? AND video_id = ?").run(profileId, videoId);
    const insert = database.prepare("INSERT INTO saved_item_folders (profile_id, video_id, folder_id) VALUES (?, ?, ?)");
    for (const folderId of uniqueFolderIds) insert.run(profileId, videoId, folderId);
  }
  if (tagIds !== undefined) {
    const uniqueTagIds = validateCollectionIds(database, profileId, tagIds, "tag");
    database.prepare("DELETE FROM saved_item_tags WHERE profile_id = ? AND video_id = ?").run(profileId, videoId);
    const insert = database.prepare("INSERT INTO saved_item_tags (profile_id, video_id, tag_id) VALUES (?, ?, ?)");
    for (const tagId of uniqueTagIds) insert.run(profileId, videoId, tagId);
  }
}

function validateCollectionIds(database: Database.Database, profileId: string, ids: string[], kind: CollectionKind) {
  const table = kind === "folder" ? "saved_folders" : "saved_tags";
  const uniqueIds = [...new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))];
  const exists = database.prepare(`SELECT id FROM ${table} WHERE profile_id = ? AND id = ?`);
  for (const id of uniqueIds) {
    if (!exists.get(profileId, id)) {
      throw new Error(`${kind === "folder" ? "Folder" : "Tag"} not found.`);
    }
  }
  return uniqueIds;
}

function addItemToDefaultFolder(database: Database.Database, profileId: string, videoId: string) {
  const folder = database
    .prepare("SELECT id FROM saved_folders WHERE profile_id = ? AND normalized_name = ?")
    .get(profileId, normalizeCollectionName("Watch Later")) as { id: string } | undefined;
  if (folder) {
    database.prepare("INSERT OR IGNORE INTO saved_item_folders (profile_id, video_id, folder_id) VALUES (?, ?, ?)")
      .run(profileId, videoId, folder.id);
  }
}

export function removeSavedItem(database: Database.Database, profileId: string, videoId: string) {
  const result = database.prepare("DELETE FROM saved_items WHERE profile_id = ? AND video_id = ?").run(profileId, videoId);
  database.prepare("DELETE FROM saved_videos WHERE profile_id = ? AND video_id = ?").run(profileId, videoId);
  if (result.changes > 0) touchProfile(database, profileId, Date.now());
  return result.changes > 0;
}

export function getSavedItem(database: Database.Database, profileId: string, videoId: string) {
  return readSavedItems(database, profileId).find((item) => item.video.id === videoId) || null;
}

export function listSavedItems(database: Database.Database, profileId: string, filters: SavedItemFilters = {}) {
  const items = readSavedItems(database, profileId);
  const query = normalizeSearchText(filters.query || "");
  return items.filter((item) => {
    if (filters.folderId && !item.folders.some((folder) => folder.id === filters.folderId)) return false;
    if (filters.tagId && !item.tags.some((tag) => tag.id === filters.tagId)) return false;
    if (!query) return true;

    const haystack = normalizeSearchText([
      item.video.id,
      item.video.title,
      item.video.author,
      item.video.query,
      item.note,
      ...item.folders.map((folder) => folder.name),
      ...item.tags.map((tag) => tag.name)
    ].filter(Boolean).join(" "));
    return haystack.includes(query);
  });
}

export function searchSavedItems(database: Database.Database, profileId: string, query: string) {
  return listSavedItems(database, profileId, { query });
}

export function clearSavedCollectionsForProfile(database: Database.Database, profileId: string) {
  database.prepare("DELETE FROM saved_items WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM saved_videos WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM saved_folders WHERE profile_id = ?").run(profileId);
  database.prepare("DELETE FROM saved_tags WHERE profile_id = ?").run(profileId);
  ensureDefaultFolders(database, profileId);
}

export function cleanCollectionName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeCollectionName(name: string) {
  return cleanCollectionName(name).toLocaleLowerCase();
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function cleanNote(note: string) {
  return note.replace(/\r\n/g, "\n").trim().slice(0, 5000);
}

function readSavedItems(database: Database.Database, profileId: string) {
  const rows = database
    .prepare("SELECT profile_id, video_id, video_json, saved_at, updated_at, note FROM saved_items WHERE profile_id = ? ORDER BY saved_at DESC, video_id ASC")
    .all(profileId) as SavedItemRow[];
  const folders = database
    .prepare(
      `SELECT link.video_id, collection.id, collection.name, collection.created_at, collection.updated_at
       FROM saved_item_folders link
       JOIN saved_folders collection ON collection.id = link.folder_id
       WHERE link.profile_id = ?`
    )
    .all(profileId) as Array<{ video_id: string } & CollectionRow>;
  const tags = database
    .prepare(
      `SELECT link.video_id, collection.id, collection.name, collection.created_at, collection.updated_at
       FROM saved_item_tags link
       JOIN saved_tags collection ON collection.id = link.tag_id
       WHERE link.profile_id = ?`
    )
    .all(profileId) as Array<{ video_id: string } & CollectionRow>;
  const foldersByVideo = groupCollections(folders);
  const tagsByVideo = groupCollections(tags);

  return rows.flatMap((row) => {
    try {
      const video = JSON.parse(row.video_json) as FeedVideo;
      return [{
        video,
        savedAt: row.saved_at,
        updatedAt: row.updated_at,
        note: row.note || "",
        folders: foldersByVideo.get(row.video_id) || [],
        tags: tagsByVideo.get(row.video_id) || []
      } satisfies SavedItem];
    } catch {
      return [];
    }
  });
}

function groupCollections(rows: Array<{ video_id: string } & CollectionRow>) {
  const grouped = new Map<string, SavedCollection[]>();
  for (const row of rows) {
    const values = grouped.get(row.video_id) || [];
    values.push(toCollection(row));
    grouped.set(row.video_id, values);
  }
  return grouped;
}

function getCollection(database: Database.Database, profileId: string, id: string, kind: CollectionKind) {
  const table = kind === "folder" ? "saved_folders" : "saved_tags";
  const row = database
    .prepare(`SELECT id, name, created_at, updated_at FROM ${table} WHERE profile_id = ? AND id = ?`)
    .get(profileId, id) as CollectionRow | undefined;
  return row ? toCollection(row) : null;
}

function toCollection(row: CollectionRow): SavedCollection {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function touchProfile(database: Database.Database, profileId: string, now: number) {
  database.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(now, profileId);
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
