"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkX, FolderInput, Loader2, StickyNote } from "lucide-react";

import type { FeedVideo, SavedCollection, SavedItem } from "../types";

export type SavedCollectionsResult = {
  items: SavedItem[];
  videos: FeedVideo[];
  savedVideoIds: string[];
  folders: SavedCollection[];
  tags: SavedCollection[];
};

export type SavedCollectionsState = {
  items: SavedItem[];
  folders: SavedCollection[];
  tags: SavedCollection[];
  loading: boolean;
  error: string;
  pendingSaves: Set<string>;
};

type Mutation = {
  profileId: string;
  action: string;
  payload?: Record<string, unknown>;
};

const initialState: SavedCollectionsState = {
  items: [],
  folders: [],
  tags: [],
  loading: false,
  error: "",
  pendingSaves: new Set()
};

export function useSavedCollections(profileId: string, fetcher: typeof fetch) {
  const [state, setState] = useState<SavedCollectionsState>(initialState);
  const requestIdRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyResponse = useCallback((body: {
    items?: SavedItem[];
    folders?: SavedCollection[];
    tags?: SavedCollection[];
  }) => {
    setState((current) => ({
      ...current,
      items: Array.isArray(body.items) ? body.items : current.items,
      folders: Array.isArray(body.folders) ? body.folders : current.folders,
      tags: Array.isArray(body.tags) ? body.tags : current.tags,
      loading: false,
      error: ""
    }));
  }, []);

  const refresh = useCallback(async (nextProfileId = profileId, query?: { q?: string; folderId?: string; tagId?: string }) => {
    if (!nextProfileId) {
      setState((current) => ({ ...current, items: [], folders: [], tags: [], loading: false }));
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, loading: true, error: "" }));

    try {
      const params = new URLSearchParams({ profileId: nextProfileId });
      if (query?.q) params.set("q", query.q);
      if (query?.folderId) params.set("folderId", query.folderId);
      if (query?.tagId) params.set("tagId", query.tagId);
      const response = await fetcher(`/api/saved-collections?${params.toString()}`);
      const body = await response.json();

      if (requestId !== requestIdRef.current) {
        return null;
      }

      if (!response.ok) {
        throw new Error(body.error || "Could not load saved collections.");
      }

      applyResponse(body);
      return body as SavedCollectionsResult;
    } catch (caught) {
      if (requestId !== requestIdRef.current) {
        return null;
      }

      const message = caught instanceof Error ? caught.message : "Could not load saved collections.";
      setState((current) => ({ ...current, loading: false, error: message }));
      throw caught instanceof Error ? caught : new Error(message);
    }
  }, [applyResponse, fetcher, profileId]);

  const mutate = useCallback(async (mutation: Omit<Mutation, "profileId">, optimistic?: (current: SavedCollectionsState) => Partial<SavedCollectionsState>) => {
    const targetProfileId = profileId;
    if (!targetProfileId) {
      throw new Error("Select a profile first.");
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const snapshot = stateRef.current;

    if (optimistic) {
      setState((current) => ({ ...current, ...optimistic(current), error: "" }));
    } else {
      setState((current) => ({ ...current, error: "" }));
    }

    try {
      const response = await fetcher("/api/saved-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: targetProfileId, action: mutation.action, ...(mutation.payload || {}) })
      });
      const body = await response.json();

      if (requestId !== requestIdRef.current) {
        throw new Error("Saved update superseded by a newer request.");
      }

      if (!response.ok) {
        throw new Error(body.error || "Could not update saved collections.");
      }

      applyResponse(body);
      return body as SavedCollectionsResult;
    } catch (caught) {
      if (requestId === requestIdRef.current) {
        setState({ ...snapshot, error: caught instanceof Error ? caught.message : "Could not update saved collections." });
      }
      throw caught instanceof Error ? caught : new Error("Could not update saved collections.");
    }
  }, [applyResponse, fetcher, profileId]);

  const toggleSave = useCallback(async (video: FeedVideo, saved: boolean) => {
    if (saved) {
      return mutate({ action: "unsave", payload: { videoId: video.id } }, (current) => ({
        items: current.items.filter((item) => item.video.id !== video.id),
        pendingSaves: new Set([...current.pendingSaves, video.id])
      }));
    }

    return mutate({ action: "save", payload: { video } }, (current) => {
      if (current.items.some((item) => item.video.id === video.id)) {
        return {};
      }
      const now = Date.now();
      return {
        items: [{ video, savedAt: now, updatedAt: now, note: "", folders: [], tags: [] }, ...current.items],
        pendingSaves: new Set([...current.pendingSaves, video.id])
      };
    });
  }, [mutate]);

  useEffect(() => {
    setState((current) => ({ ...current, pendingSaves: new Set() }));
  }, [profileId]);

  return { state, refresh, mutate, toggleSave };
}

export function SavedToggleIcon({ saved, pending }: { saved: boolean; pending: boolean }) {
  if (pending) {
    return <Loader2 aria-hidden="true" size={16} className="spin" />;
  }
  if (saved) {
    return <Bookmark aria-hidden="true" size={16} fill="currentColor" />;
  }
  return <Bookmark aria-hidden="true" size={16} />;
}

export function SavedToastAction({ icon, label }: { icon: "unsave" | "organize" | "note"; label: string }) {
  if (icon === "unsave") return <BookmarkX aria-hidden="true" size={15} />;
  if (icon === "organize") return <FolderInput aria-hidden="true" size={15} />;
  return <StickyNote aria-hidden="true" size={15} />;
}

export function savedItemTitle(item: SavedItem) {
  return item.video.title;
}

export function savedItemKey(item: SavedItem) {
  return item.video.id;
}
