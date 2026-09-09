"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedVideo } from "../types";
import { authedHeaders } from "./video-utils";

export type QueueSnapshot = {
  items: FeedVideo[];
  currentVideoId: string | null;
  autoplayEnabled: boolean;
  currentVideo: FeedVideo | null;
  upNextVideos: FeedVideo[];
};

export type QueueTransitionKind = "advanced" | "stopped" | "ended";

export type QueueTransitionResult = {
  kind: QueueTransitionKind;
  video: FeedVideo | null;
};

type QueueStatePayload = {
  items: FeedVideo[];
  currentVideoId: string | null;
  autoplayEnabled: boolean;
};

function toSnapshot(state: QueueStatePayload): QueueSnapshot {
  const items = Array.isArray(state.items) ? state.items : [];
  const currentIndex = items.findIndex((video) => video.id === state.currentVideoId);
  return {
    items,
    currentVideoId: state.currentVideoId ?? null,
    autoplayEnabled: state.autoplayEnabled !== false,
    currentVideo: currentIndex >= 0 ? items[currentIndex] : null,
    upNextVideos: currentIndex < 0 ? items.slice() : items.slice(currentIndex + 1)
  };
}

function snapshotFromResponse(data: any): QueueSnapshot | null {
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
    return null;
  }

  if (Array.isArray(data.upNextVideos)) {
    return {
      items: data.items,
      currentVideoId: data.currentVideoId ?? null,
      autoplayEnabled: data.autoplayEnabled !== false,
      currentVideo: data.currentVideo ?? null,
      upNextVideos: data.upNextVideos
    };
  }

  // "next" and "ended" transitions return { kind, state, video } instead of a snapshot.
  if (data.state && Array.isArray(data.state.items)) {
    return toSnapshot(data.state);
  }

  return toSnapshot(data);
}

function transitionFromResponse(data: any): QueueTransitionResult {
  const kind = data?.kind === "advanced" || data?.kind === "stopped" || data?.kind === "ended"
    ? data.kind
    : data?.transition === "advanced" || data?.transition === "stopped" || data?.transition === "ended"
      ? data.transition
      : "stopped";
  const video = data?.video && typeof data.video === "object" && typeof data.video.id === "string"
    ? (data.video as FeedVideo)
    : null;
  return { kind, video };
}

export function usePlaybackQueue(profileId: string) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const snapshotRef = useRef<QueueSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!profileId) {
      requestIdRef.current += 1;
      setSnapshot(null);
      setError("");
      setLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/queue?profileId=${encodeURIComponent(profileId)}`, {
        headers: authedHeaders()
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load the playback queue.");
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setSnapshot(snapshotFromResponse(data));
    } catch (caught) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : "Could not load the playback queue.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (action: string, body: Record<string, unknown> = {}): Promise<any> => {
      if (!profileId) {
        return null;
      }

      setMutating(true);
      setError("");

      try {
        const response = await fetch("/api/queue", {
          method: "POST",
          headers: authedHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ profileId, action, ...body })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not update the playback queue.");
        }

        const nextSnapshot = snapshotFromResponse(data);
        if (nextSnapshot) {
          setSnapshot(nextSnapshot);
        }

        return data;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not update the playback queue.");
        return null;
      } finally {
        setMutating(false);
      }
    },
    [profileId]
  );

  const enqueue = useCallback(
    (video: FeedVideo) => mutate("enqueue", { video }),
    [mutate]
  );

  const remove = useCallback(
    (videoId: string) => mutate("remove", { videoId }),
    [mutate]
  );

  const move = useCallback(
    (videoId: string, toIndex: number) => mutate("reorder", { videoId, toIndex }),
    [mutate]
  );

  const clear = useCallback(() => mutate("clear"), [mutate]);

  const setCurrent = useCallback(
    (videoId: string | null) => mutate("current", { videoId }),
    [mutate]
  );

  const setAutoplay = useCallback(
    (enabled: boolean) => mutate("autoplay", { enabled }),
    [mutate]
  );

  /** Point the cursor at a video that is already queued, ignoring anything else. */
  const setCurrentIfQueued = useCallback(
    (videoId: string) => {
      const current = snapshotRef.current;
      if (!current || current.currentVideoId === videoId) {
        return Promise.resolve(null);
      }
      if (!current.items.some((video) => video.id === videoId)) {
        return Promise.resolve(null);
      }
      return mutate("current", { videoId });
    },
    [mutate]
  );

  const advanceNext = useCallback(async (): Promise<QueueTransitionResult | null> => {
    const data = await mutate("next");
    return data ? transitionFromResponse(data) : null;
  }, [mutate]);

  const resolveEnded = useCallback(async (): Promise<QueueTransitionResult | null> => {
    const data = await mutate("ended");
    return data ? transitionFromResponse(data) : null;
  }, [mutate]);

  return {
    snapshot,
    loading,
    mutating,
    error,
    refresh,
    enqueue,
    remove,
    move,
    clear,
    setCurrent,
    setCurrentIfQueued,
    setAutoplay,
    advanceNext,
    resolveEnded
  };
}
