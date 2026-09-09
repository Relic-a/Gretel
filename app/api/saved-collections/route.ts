import {
  createSavedFolder,
  createSavedTag,
  deleteSavedFolder,
  deleteSavedTag,
  listSavedFolders,
  listSavedItems,
  listSavedTags,
  removeSavedItem,
  renameSavedFolder,
  renameSavedTag,
  saveSavedItem,
  updateSavedItem
} from "../../../lib/saved-collections";
import { getDatabase, getProfile } from "../../../lib/profile-store";
import type { FeedVideo } from "../../../lib/feed/types";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId") || "";
    if (!getProfile(profileId)) {
      return Response.json({ error: "Select a profile first." }, { status: 400 });
    }

    const database = getDatabase();
    const items = listSavedItems(database, profileId, {
      query: url.searchParams.get("q") || url.searchParams.get("query") || undefined,
      folderId: url.searchParams.get("folderId") || undefined,
      tagId: url.searchParams.get("tagId") || undefined
    });
    return Response.json({
      items,
      videos: items.map((item) => item.video),
      savedVideoIds: items.map((item) => item.video.id),
      folders: listSavedFolders(database, profileId),
      tags: listSavedTags(database, profileId)
    });
  } catch {
    return Response.json({ error: "Could not load saved collections." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    if (!getProfile(profileId)) {
      return Response.json({ error: "Select a profile first." }, { status: 400 });
    }

    const database = getDatabase();
    const action = typeof body.action === "string" ? body.action : "";
    switch (action) {
      case "save": {
        const video = asVideo(body.video);
        if (!video) return badRequest("Choose a video to save.");
        const options: { note?: string; folderIds?: string[]; tagIds?: string[] } = {};
        if (typeof body.note === "string") options.note = body.note;
        if (body.folderIds !== undefined) options.folderIds = asStringArray(body.folderIds);
        if (body.tagIds !== undefined) options.tagIds = asStringArray(body.tagIds);
        saveSavedItem(database, profileId, video, options);
        break;
      }
      case "unsave": {
        const videoId = asNonEmptyString(body.videoId);
        if (!videoId) return badRequest("Choose a saved video to remove.");
        removeSavedItem(database, profileId, videoId);
        break;
      }
      case "update-item": {
        const videoId = asNonEmptyString(body.videoId);
        if (!videoId) return badRequest("Choose a saved video to update.");
        updateSavedItem(database, profileId, videoId, {
          note: typeof body.note === "string" ? body.note : undefined,
          folderIds: body.folderIds === undefined ? undefined : asStringArray(body.folderIds),
          tagIds: body.tagIds === undefined ? undefined : asStringArray(body.tagIds)
        });
        break;
      }
      case "create-folder":
        createSavedFolder(database, profileId, String(body.name || ""));
        break;
      case "rename-folder":
        renameSavedFolder(database, profileId, String(body.folderId || ""), String(body.name || ""));
        break;
      case "delete-folder":
        deleteSavedFolder(database, profileId, String(body.folderId || ""));
        break;
      case "create-tag":
        createSavedTag(database, profileId, String(body.name || ""));
        break;
      case "rename-tag":
        renameSavedTag(database, profileId, String(body.tagId || ""), String(body.name || ""));
        break;
      case "delete-tag":
        deleteSavedTag(database, profileId, String(body.tagId || ""));
        break;
      default:
        return badRequest("Choose a saved collection action.");
    }

    return savedCollectionsResponse(database, profileId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update saved collections." }, { status: 400 });
  }
}

function savedCollectionsResponse(database: ReturnType<typeof getDatabase>, profileId: string) {
  const items = listSavedItems(database, profileId);
  return Response.json({
    items,
    videos: items.map((item) => item.video),
    savedVideoIds: items.map((item) => item.video.id),
    folders: listSavedFolders(database, profileId),
    tags: listSavedTags(database, profileId)
  });
}

function asVideo(value: unknown): FeedVideo | null {
  if (!value || typeof value !== "object") return null;
  const video = value as Partial<FeedVideo>;
  if (typeof video.id !== "string" || !video.id.trim() || typeof video.title !== "string" || typeof video.author !== "string" || typeof video.duration !== "string" || typeof video.query !== "string") {
    return null;
  }
  return video as FeedVideo;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}
