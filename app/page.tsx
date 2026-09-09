"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellOff, Bookmark, EyeOff, LoaderCircle, ThumbsDown, X } from "lucide-react";

import type { CardFeedbackAction } from "./components/VideoActions";
import { ProfileModal } from "./components/ProfileModal";
import { SettingsModal } from "./components/SettingsModal";
import { TopBar } from "./components/TopBar";
import { FeedView } from "./components/FeedView";
import { OrganizeDialog, SavedWorkspace, type OrganizeDraft, type SavedFilter } from "./components/SavedWorkspace";
import { useSavedCollections, type SavedCollectionsResult } from "./components/use-saved-collections";
import { WatchView } from "./components/WatchView";
import { QueuePanel } from "./components/QueuePanel";
import {
  buildFeedbackPayload,
  channelMatchesVideo,
  feedbackTargetIds,
  feedbackToastCopy
} from "./components/feedback-client";
import { usePlaybackQueue } from "./components/use-playback-queue";
import { authedHeaders, normalize } from "./components/video-utils";
import { fetchStartupFeed } from "../lib/feed/startup-request";
import type {
  ChannelResult,
  FeedResponse,
  FeedVideo,
  Profile,
  PublicGretelConfig,
  SavedCollectionsResponse,
  UserSettings
} from "./types";

function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const customHeaders: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((val, key) => {
        customHeaders[key] = val;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, val] of init.headers) {
        customHeaders[key] = val;
      }
    } else {
      Object.assign(customHeaders, init.headers);
    }
  }
  return fetch(input, {
    ...init,
    headers: authedHeaders(customHeaders)
  });
}

const clientStateKey = "gretel.clientState.v2";
const feedCachePrefix = "gretel.feedCache.v1";
const activeVideoSessionKey = "gretel.activeVideo.v1";
const starterTagSuggestions = ["AI engineering", "TypeScript", "product design"];

type CachedFeed = FeedResponse & {
  tags?: string[];
  channels?: string[];
  channelSort?: string;
};
type Section = "home" | "saved" | "history";

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [newProfileTags, setNewProfileTags] = useState<string[]>([]);
  const [newProfileChannels, setNewProfileChannels] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [channelDraft, setChannelDraft] = useState("");
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [isSearchingChannels, setIsSearchingChannels] = useState(false);
  const channelSearchCacheRef = useRef<Map<string, ChannelResult[]>>(new Map());
  const searchRequestIdRef = useRef(0);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [config, setConfig] = useState<PublicGretelConfig | null>(null);
  const [section, setSection] = useState<Section>("home");
  const [savedVideos, setSavedVideos] = useState<FeedVideo[]>([]);
  const [historyVideos, setHistoryVideos] = useState<FeedVideo[]>([]);
  const savedCollections = useSavedCollections(profileId, authedFetch);
  const savedItems = savedCollections.state.items;
  const savedFolders = savedCollections.state.folders;
  const savedTags = savedCollections.state.tags;
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(new Set());
  const [activeVideo, setActiveVideo] = useState<FeedVideo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FeedVideo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState<{ session: string; page: number } | null>(null);
  const [loadingSearchMore, setLoadingSearchMore] = useState(false);
  const searchMoreRequestRef = useRef(false);

  useEffect(() => {
    resetSearchRequest();
  }, [profileId, section, tags, channels]);

  function resetSearchRequest() {
    searchRequestIdRef.current += 1;
    setSearching(false);
    setLoadingSearchMore(false);
    searchMoreRequestRef.current = false;
    setSearchCursor(null);
  }
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildingLabel, setBuildingLabel] = useState("");
  const [feedEnd, setFeedEnd] = useState(false);
  const [booted, setBooted] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [manageProfiles, setManageProfiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({});
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState<{ action: CardFeedbackAction; videoId: string } | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{
    kind: "removed" | "muted" | "error";
    title: string;
    detail: string;
    action?: CardFeedbackAction;
    video?: FeedVideo;
    removedIds?: string[];
    key: number;
  } | null>(null);
  const [saveNotice, setSaveNotice] = useState<{ video: FeedVideo; key: number } | null>(null);
  const saveNoticeTimerRef = useRef<number | null>(null);
  const feedbackNoticeTimerRef = useRef<number | null>(null);
  const feedbackSnapshotRef = useRef<{ videos: FeedVideo[]; search: FeedVideo[] | null; active: FeedVideo | null } | null>(null);
  const [savedFilter, setSavedFilter] = useState<SavedFilter>({ folderId: null, tagId: null, query: "" });
  const [saveDialog, setSaveDialog] = useState<OrganizeDraft | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueNotice, setQueueNotice] = useState(false);
  useEffect(() => {
    if (!queueNotice) return;
    const timer = window.setTimeout(() => setQueueNotice(false), 5000);
    return () => window.clearTimeout(timer);
  }, [queueNotice]);
  const videoRef = useRef<HTMLIFrameElement | null>(null);
  const pendingVideoIdRef = useRef<string | null>(null);
  const pendingVideoRestoreInFlightRef = useRef<string | null>(null);
  const feedRequestIdRef = useRef(0);
  const pendingImpressionIdsRef = useRef<Set<string>>(new Set());
  const impressionTimerRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const subscriptions = useMemo(
    () => new Set(channels.map((channel) => normalize(channel))),
    [channels]
  );
  const activeProfile = profiles.find((profile) => profile.id === profileId);
  const needsProfile = booted && profiles.length === 0 && !feed;
  const needsOpenRouterKey = settings.openRouterApiKey !== "set";
  const homeVideos = feed?.videos || [];
  const visibleVideos = searchResults ?? (
    section === "saved" ? savedVideos : section === "history" ? historyVideos : homeVideos
  );
  const sideVideos = orderedSideVideos(visibleVideos, activeVideo, feed?.upNextByVideoId);
  const canAskForMore = searchResults === null && section === "home" && Boolean(feed) && !loading && !feedEnd;

  useEffect(() => {
    let reporting = false;
    let lastReportedAt = 0;

    function reportClientError(source: string, error: unknown, location?: { url?: string; line?: number; column?: number }) {
      const now = Date.now();
      if (reporting || now - lastReportedAt < 1000) return;
      reporting = true;
      lastReportedAt = now;
      const normalized = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };
      const payload = JSON.stringify({ source, ...normalized, ...location });
      void authedFetch("/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true
      }).catch(() => undefined).finally(() => {
        reporting = false;
      });
    }

    function handleError(event: ErrorEvent) {
      reportClientError("window.error", event.error || event.message, {
        url: event.filename,
        line: event.lineno,
        column: event.colno
      });
    }

    function handleRejection(event: PromiseRejectionEvent) {
      reportClientError("window.unhandled_rejection", event.reason);
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    async function boot() {
      const saved = readSavedState();
      const route = readRouteFromUrl();
      const stashedActiveVideo = readStashedActiveVideo(route.videoId);
      const [selectedProfile] = await Promise.all([
        loadProfiles(saved?.profileId),
        loadPublicConfig(),
        loadSettings()
      ]);
      const selectedProfileId = selectedProfile?.id || "";
      const cachedFeed = selectedProfileId ? readCachedFeed(selectedProfileId) : null;
      const nextTags = selectedProfile?.tags?.length
        ? selectedProfile.tags
        : saved?.profileId === selectedProfileId && saved.tags.length
          ? saved.tags
          : [];
      const nextChannels = selectedProfile?.channels?.length
        ? selectedProfile.channels
        : saved?.profileId === selectedProfileId
          ? saved.channels
          : [];
      const paintCache =
        cachedFeed && feedPreferencesMatch(cachedFeed, nextTags, nextChannels)
          ? cachedFeed
          : null;

      if (disposed) {
        return;
      }

      setTags(nextTags);
      setChannels(nextChannels);
      setBooted(true);
      setSection(route.section);
      pendingVideoIdRef.current = route.videoId;

      if (stashedActiveVideo) {
        setActiveVideo(stashedActiveVideo);
        pendingVideoIdRef.current = null;
      }

      if (paintCache) {
        setFeed(paintCache);
      }

      if (selectedProfileId) {
        await loadSavedVideos(selectedProfileId);
        await loadLikedVideos(selectedProfileId);

        if (route.section === "history") {
          await loadHistoryVideos(selectedProfileId);
        }

        const shouldRequestHomeFeed =
          route.section === "home" &&
          !stashedActiveVideo &&
          (nextTags.length > 0 || nextChannels.length > 0);

        if (shouldRequestHomeFeed) {
          await requestFeed({
            nextProfileId: selectedProfileId,
            nextTags,
            nextChannels,
            resetFeed: true,
            buildIfMissing: true
          });
        }
      }
    }

    boot().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Could not start Gretel.");
      setBooted(true);
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    function applyRoute() {
      const route = readRouteFromUrl();
      const stashedActiveVideo = readStashedActiveVideo(route.videoId);
      pendingVideoIdRef.current = route.videoId;
      setSection(route.section);

      if (stashedActiveVideo) {
        setActiveVideo(stashedActiveVideo);
        pendingVideoIdRef.current = null;
      } else if (!route.videoId) {
        setActiveVideo(null);
      } else {
        setActiveVideo((current) => (current?.id === route.videoId ? current : null));
      }

      if (route.section === "saved") {
        void loadSavedVideos(profileId).catch((caught) =>
          setError(caught instanceof Error ? caught.message : "Could not load saved videos.")
        );
      }

      if (route.section === "history") {
        void loadHistoryVideos(profileId).catch((caught) =>
          setError(caught instanceof Error ? caught.message : "Could not load history.")
        );
      }
    }

    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, [profileId]);

  useEffect(() => {
    const pendingVideoId = pendingVideoIdRef.current;

    if (!booted || !pendingVideoId) {
      return;
    }

    if (activeVideo?.id === pendingVideoId) {
      pendingVideoIdRef.current = null;
      return;
    }

    const matchingVideo = visibleVideos.find((video) => video.id === pendingVideoId);

    if (matchingVideo) {
      setActiveVideo(matchingVideo);
      pendingVideoIdRef.current = null;
      return;
    }

    if (!profileId || pendingVideoRestoreInFlightRef.current === pendingVideoId) {
      return;
    }

    pendingVideoRestoreInFlightRef.current = pendingVideoId;

    void (async () => {
      try {
        const restored = await fetchVideoInfo(profileId, pendingVideoId);

        if (restored) {
          setActiveVideo(restored);
        }
      } finally {
        if (pendingVideoIdRef.current === pendingVideoId) {
          pendingVideoIdRef.current = null;
        }
        if (pendingVideoRestoreInFlightRef.current === pendingVideoId) {
          pendingVideoRestoreInFlightRef.current = null;
        }
      }
    })();
  }, [activeVideo, booted, profileId, visibleVideos]);

  useEffect(() => {
    if (!booted) {
      return;
    }

    window.localStorage.setItem(clientStateKey, JSON.stringify({ profileId, tags, channels }));
  }, [booted, profileId, tags, channels]);

  useEffect(() => {
    if (!booted || !profileId || !feed?.videos?.length) {
      return;
    }

    writeCachedFeed(profileId, feed);
  }, [booted, profileId, feed]);

  useEffect(() => {
    if (!booted) {
      return;
    }

    if (activeVideo) {
      writeStashedActiveVideo(activeVideo);
      return;
    }

    clearStashedActiveVideo();
  }, [activeVideo, booted]);

  useEffect(() => {
    return () => {
      if (impressionTimerRef.current !== null) {
        window.clearTimeout(impressionTimerRef.current);
      }
    };
  }, []);

  const watchSessionRef = useRef<{
    videoId: string;
    watchedSeconds: number;
    durationSeconds: number;
    savedHistory: boolean;
    completed: boolean;
  }>({
    videoId: "",
    watchedSeconds: 0,
    durationSeconds: 0,
    savedHistory: false,
    completed: false
  });

  useEffect(() => {
    if (!activeVideo || !profileId) {
      return;
    }

    const currentVideo = activeVideo;
    const initialDuration = parseDurationToSeconds(currentVideo.duration);

    watchSessionRef.current = {
      videoId: currentVideo.id,
      watchedSeconds: 0,
      durationSeconds: initialDuration,
      savedHistory: false,
      completed: false
    };

    async function flushSession() {
      const session = watchSessionRef.current;
      if (session.videoId === currentVideo.id && session.watchedSeconds > 0) {
        try {
          const saved = await reportWatchEvent(
            profileId,
            currentVideo,
            session.watchedSeconds,
            session.durationSeconds
          );
          if (saved && section === "history") {
            await loadHistoryVideos(profileId);
          }
        } catch {}
      }
    }

    const handlePageHide = () => {
      void flushSession();
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      void flushSession();
    };
  }, [activeVideo, profileId, section]);

  const handleWatchTimeUpdate = useCallback(
    (currentTime: number, duration: number) => {
      if (!activeVideo || !profileId) return;

      const session = watchSessionRef.current;
      if (session.videoId !== activeVideo.id) return;

      const durationSeconds = Math.max(
        1,
        Math.round(duration || session.durationSeconds || parseDurationToSeconds(activeVideo.duration))
      );
      const watchedSeconds = Math.max(session.watchedSeconds, Math.round(currentTime));

      session.watchedSeconds = watchedSeconds;
      session.durationSeconds = durationSeconds;

      const ratio = durationSeconds > 0 ? watchedSeconds / durationSeconds : 0;
      const historyThreshold = config?.learning.watchSaveThreshold ?? 0.1;
      const completionThreshold = config?.learning.watchCompletionThreshold ?? 0.6;

      // Progressive 10% Milestone -> Save to history immediately
      if (!session.savedHistory && ratio >= historyThreshold) {
        session.savedHistory = true;
        void reportWatchEvent(profileId, activeVideo, watchedSeconds, durationSeconds).then((saved) => {
          if (saved && section === "history") {
            void loadHistoryVideos(profileId);
          }
        });
      }

      // Progressive 90% Milestone -> Mark video completed for feed exclusion
      if (!session.completed && ratio >= completionThreshold) {
        session.completed = true;
        void reportWatchEvent(profileId, activeVideo, watchedSeconds, durationSeconds);
      }
    },
    [activeVideo, config?.learning.watchCompletionThreshold, config?.learning.watchSaveThreshold, profileId, section]
  );

  useEffect(() => {
    const trimmed = channelDraft.trim();
    if (trimmed.length < 2) {
      setChannelResults([]);
      setIsSearchingChannels(false);
      return;
    }

    const normalized = trimmed.replace(/^@+/, "").toLowerCase();
    const cached = channelSearchCacheRef.current.get(normalized);
    if (cached) {
      setChannelResults(cached);
      setIsSearchingChannels(false);
      return;
    }

    // Keep currently matching results visible during typing to prevent flashing
    setChannelResults((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const cleanNorm = normalized.replace(/\s+/g, "");
      const matching = prev.filter((c) =>
        c.name.toLowerCase().replace(/\s+/g, "").includes(cleanNorm)
      );
      return matching.length > 0 ? matching : prev;
    });

    setIsSearchingChannels(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await authedFetch(
          `/api/channels/search?q=${encodeURIComponent(trimmed)}&profileId=${encodeURIComponent(profileId || "setup")}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        const channels = data.channels || [];

        if (!controller.signal.aborted) {
          channelSearchCacheRef.current.set(normalized, channels);
          setChannelResults(channels);
          setIsSearchingChannels(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsSearchingChannels(false);
        }
      }
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [channelDraft, profileId]);

  async function loadProfiles(nextProfileId?: string) {
    const response = await authedFetch("/api/profiles");
    const data = await response.json();
    const nextProfiles = data.profiles || [];
    const selected =
      nextProfiles.find((profile: Profile) => profile.id === nextProfileId) || nextProfiles[0];

    setProfiles(nextProfiles);
    setProfileId(selected?.id || "");
    return selected as Profile | undefined;
  }

  async function loadPublicConfig() {
    const response = await authedFetch("/api/config");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load Gretel config.");
    }

    setConfig(data);
  }

  async function loadSettings() {
    const response = await authedFetch("/api/settings");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load settings.");
    }

    setSettings(data);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSettingsError("");
    setSavingSettings(true);

    try {
      const response = await authedFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save settings.");
      }

      setSettings(data);
      setShowSettings(false);
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function createProfileAndBuild(event?: FormEvent) {
    event?.preventDefault();

    if (!profileName.trim()) {
      return;
    }

    const createdTags = newProfileTags;
    const createdChannels = newProfileChannels;

    const hasKey =
      Boolean(settings.openRouterApiKey) &&
      settings.openRouterApiKey !== "set" &&
      (settings.openRouterApiKey || "").trim().length > 0;

    if (needsOpenRouterKey && !hasKey) {
      setError("Enter your OpenRouter API key before creating a profile.");
      return;
    }

    setError("");
    setLoading(true);
    setBuildingLabel(needsOpenRouterKey ? "Saving your API key..." : "Creating your profile...");

    try {
      if (needsOpenRouterKey && hasKey) {
        const settingsResponse = await authedFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings)
        });
        const savedSettings = await settingsResponse.json();

        if (!settingsResponse.ok) {
          throw new Error(savedSettings.error || "Could not save settings.");
        }

        setSettings(savedSettings);
      }

      setBuildingLabel("Creating your profile...");
      const response = await authedFetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          tags: createdTags,
          channels: createdChannels
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not add this profile.");
      }

      setProfiles(data.profiles || []);
      setProfileId(data.profileId || "");
      setProfileName("");
      setTags(createdTags);
      setChannels(createdChannels);
      setNewProfileTags([]);
      setNewProfileChannels([]);
      setFeed(null);
      setActiveVideo(null);
      setManageProfiles(false);
      setSection("home");
      setSavedVideos([]);
      setHistoryVideos([]);
      setSavedVideoIds(new Set());
      setLikedVideoIds(new Set());
      clearCachedFeed(data.profileId || "");
      writeRoute("home");

      setBuildingLabel("Finding videos for your feed...");
      await requestFeed({
        nextProfileId: data.profileId || "",
        nextTags: createdTags,
        nextChannels: createdChannels,
        resetFeed: true
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this profile.");
      setLoading(false);
    }
  }

  async function deleteProfile(id: string) {
    feedRequestIdRef.current += 1;
    setLoading(false);
    setIsBuilding(false);

    const response = await authedFetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", profileId: id })
    });
    const data = await response.json();
    setProfiles(data.profiles || []);
    setProfileId(data.profileId || "");
    setFeed(null);
    setActiveVideo(null);
    setSavedVideos([]);
    setHistoryVideos([]);
    setSavedVideoIds(new Set());
    setLikedVideoIds(new Set());
    writeRoute("home");
  }

  function openHome() {
    resetSearchRequest();
    setError("");
    setSection("home");
    setSearchResults(null);
    setSearchedQuery("");
    setActiveVideo(null);
    writeRoute("home");
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (!feed?.videos?.length && profileId && (tags.length > 0 || channels.length > 0)) {
      void requestFeed({
        nextProfileId: profileId,
        nextTags: tags,
        nextChannels: channels,
        resetFeed: true,
        buildIfMissing: true
      });
    }
  }

  async function buildFeed(event?: FormEvent) {
    event?.preventDefault();
    setSection("home");
    setActiveVideo(null);
    writeRoute("home");
    setFeedEnd(false);
    await requestFeed({ resetFeed: true });
  }

  function syncSavedCollectionsSnapshot(body: SavedCollectionsResult) {
    setSavedVideos(body.videos || []);
    setSavedVideoIds(new Set(body.savedVideoIds || []));
  }

  async function openSaved() {
    resetSearchRequest();
    setError("");
    setSection("saved");
    setSearchResults(null);
    setSearchedQuery("");
    setActiveVideo(null);
    writeRoute("saved");
    try {
      const body = await savedCollections.refresh(profileId);
      if (body) {
        syncSavedCollectionsSnapshot(body);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load saved videos.";
      setError(message);
    }
  }

  async function openHistory() {
    resetSearchRequest();
    setError("");
    setSection("history");
    setSearchResults(null);
    setSearchedQuery("");
    setActiveVideo(null);
    writeRoute("history");
    try {
      await loadHistoryVideos(profileId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load history.");
    }
  }

  async function loadSavedVideos(nextProfileId = profileId) {
    if (!nextProfileId) {
      return;
    }

    const body = await savedCollections.refresh(nextProfileId);
    if (body) {
      syncSavedCollectionsSnapshot(body);
    }
  }

  async function loadLikedVideos(nextProfileId = profileId) {
    if (!nextProfileId) {
      return;
    }

    const response = await authedFetch(`/api/liked-videos?profileId=${encodeURIComponent(nextProfileId)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load liked videos.");
    }

    setLikedVideoIds(new Set(data.likedVideoIds || []));
  }

  async function loadHistoryVideos(nextProfileId = profileId) {
    if (!nextProfileId) {
      return;
    }

    const response = await authedFetch(`/api/history?profileId=${encodeURIComponent(nextProfileId)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load history.");
    }

    setHistoryVideos(data.videos || []);
  }

  async function saveVideo(video: FeedVideo) {
    if (!profileId) {
      return;
    }

    const alreadySaved = savedVideoIds.has(video.id);

    try {
      const body = await savedCollections.toggleSave(video, alreadySaved);
      syncSavedCollectionsSnapshot(body);
      // Saving is one click. The organize dialog is offered as an optional
      // follow-up in the toast instead of blocking every save.
      if (!alreadySaved) {
        showSaveNotice(video);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this video.");
    }
  }

  async function updateSavedItem(videoId: string, update: { note?: string; folderIds?: string[]; tagIds?: string[] }) {
    const body = await savedCollections.mutate({ action: "update-item", payload: { videoId, ...update } });
    syncSavedCollectionsSnapshot(body);
  }

  async function savedCollectionMutation(action: string, payload: Record<string, unknown> = {}) {
    const body = await savedCollections.mutate({ action, payload });
    syncSavedCollectionsSnapshot(body);
  }

  async function likeVideo(video: FeedVideo) {
    if (!profileId) {
      return;
    }

    const response = await authedFetch("/api/liked-videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        video,
        videoId: video.id,
        action: likedVideoIds.has(video.id) ? "unlike" : "like"
      })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Could not update this like.");
      return;
    }

    setLikedVideoIds(new Set(data.likedVideoIds || []));
  }

  function recordVideoImpression(video: FeedVideo) {
    if (!profileId) {
      return;
    }

    pendingImpressionIdsRef.current.add(video.id);

    if (impressionTimerRef.current !== null) {
      return;
    }

    const targetProfileId = profileId;
    impressionTimerRef.current = window.setTimeout(async () => {
      const videoIds = [...pendingImpressionIdsRef.current];
      pendingImpressionIdsRef.current.clear();
      impressionTimerRef.current = null;

      if (videoIds.length === 0) {
        return;
      }

      try {
        await authedFetch("/api/impressions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: targetProfileId,
            tags,
            channels,
            videoIds
          })
        });
      } catch {}
    }, 50);
  }

  async function requestFeed(input: {
    nextProfileId?: string;
    nextTags?: string[];
    nextChannels?: string[];
    resetFeed?: boolean;
    buildIfMissing?: boolean;
  } = {}) {
    const nextTags = input.nextTags || tags;
    const nextChannels = input.nextChannels || channels;
    const nextProfileId = input.nextProfileId || profileId;
    const resetFeed = input.resetFeed === true;
    const servingOnly = input.buildIfMissing || !resetFeed;
    const sessionId = resetFeed ? undefined : feed?.sessionId;
    const servedVideoIds = !resetFeed && feed?.videos?.length ? feed.videos.map((video) => video.id) : [];
    const requestId = feedRequestIdRef.current + 1;
    feedRequestIdRef.current = requestId;

    setError("");
    setLoading(true);
    if (!servingOnly) {
      setIsBuilding(true);
    }
    if (resetFeed && !servingOnly) {
      setFeed(null);
      setFeedEnd(false);
    }

    try {
      const requestBody = {
        tags: nextTags,
        channels: nextChannels,
        profileId: nextProfileId,
        sessionId,
        servedVideoIds: servingOnly ? servedVideoIds : []
      };
      let response: Response;
      let responseData: any;
      if (input.buildIfMissing) {
        const result = await fetchStartupFeed(authedFetch, requestBody);
        response = result.response;
        responseData = result.data;
      } else {
        response = await authedFetch(servingOnly ? "/api/feed" : "/api/feed/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
        responseData = await response.json();
      }

      if (!response.ok) {
        throw new Error(responseData.error || "Could not build this feed.");
      }

      if (requestId !== feedRequestIdRef.current) {
        return;
      }

      setFeed((current) => {
        if (!resetFeed && current?.videos?.length) {
          const seen = new Set(current.videos.map((video) => video.id));
          const nextVideos = (responseData.videos || []).filter((video: FeedVideo) => !seen.has(video.id));
          setFeedEnd(nextVideos.length === 0);

          return {
            ...responseData,
            videos: [...current.videos, ...nextVideos]
          };
        }

        setFeedEnd(false);
        return responseData;
      });
    } catch (caught) {
      if (requestId !== feedRequestIdRef.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : "Could not build this feed.");
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setLoading(false);
        setIsBuilding(false);
      }
    }
  }

  const refreshVideos = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (searchResults !== null) {
        const query = (searchedQuery || searchQuery).trim();
        if (query) {
          await searchForVideos(query);
        }
        return;
      }
      if (section === "saved") {
        await loadSavedVideos(profileId);
        return;
      }
      if (section === "history") {
        await loadHistoryVideos(profileId);
        return;
      }
      setActiveVideo(null);
      writeRoute("home");
      setFeedEnd(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await requestFeed({ resetFeed: true, buildIfMissing: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [profileId, searchQuery, searchedQuery, searchResults, section, tags, channels, feed]);

  useEffect(() => {
    function handleRefreshShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refreshVideos();
      }
    }

    window.addEventListener("keydown", handleRefreshShortcut);
    return () => window.removeEventListener("keydown", handleRefreshShortcut);
  }, [refreshVideos]);

  async function searchForVideos(query = searchQuery.trim()) {
    const trimmed = query.trim();
    if (!profileId || trimmed.length < 2) return;

    setSearchedQuery(trimmed);

    const currentRequestId = ++searchRequestIdRef.current;
    setSearchCursor(null);
    setLoadingSearchMore(false);
    searchMoreRequestRef.current = false;
    setError("");
    setSearching(true);
    setActiveVideo(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const response = await authedFetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, query: trimmed, tags, channels })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not search videos.");
      }
      if (currentRequestId !== searchRequestIdRef.current) {
        return;
      }
      const videos = data.videos || [];
      setSearchResults(videos);
      setSearchCursor(data.cursor ?? null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      if (currentRequestId !== searchRequestIdRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not search videos.");
      setSearchResults(null);
    } finally {
      if (currentRequestId === searchRequestIdRef.current) {
        setSearching(false);
      }
    }
  }

  async function loadMoreSearch() {
    if (!searchCursor || searchMoreRequestRef.current || searching) return;
    const requestId = searchRequestIdRef.current;
    searchMoreRequestRef.current = true;
    setLoadingSearchMore(true);
    try {
      const response = await authedFetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, query: searchedQuery, tags, channels, cursor: searchCursor })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load more search results.");
      if (requestId !== searchRequestIdRef.current) return;
      setSearchResults((current) => {
        if (!current) return current;
        const seen = new Set(current.map((video) => video.id));
        return [...current, ...(data.videos as FeedVideo[]).filter((video) => !seen.has(video.id))];
      });
      setSearchCursor(data.cursor ?? null);
    } catch (caught) {
      if (requestId !== searchRequestIdRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load more search results.");
      setSearchCursor(null);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        searchMoreRequestRef.current = false;
        setLoadingSearchMore(false);
      }
    }
  }

  function handleSearchQueryChange(value: string) {
    setSearchQuery(value);
    if (value.trim().length === 0) {
      resetSearchRequest();
      if (searchResults !== null) {
        setSearchResults(null);
      }
      setSearchedQuery("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchForVideos();
  }

  function addNewProfileTag(value: string) {
    const cleaned = value.replace(/\s+/g, " ").trim();

    if (cleaned.length > 1 && !newProfileTags.some((tag) => normalize(tag) === normalize(cleaned))) {
      setNewProfileTags([...newProfileTags, cleaned]);
    }

    setTagDraft("");
  }

  function addNewProfileChannel(value: string) {
    const cleaned = value.replace(/\s+/g, " ").trim();

    if (cleaned.length > 1 && !newProfileChannels.some((channel) => normalize(channel) === normalize(cleaned))) {
      setNewProfileChannels([...newProfileChannels, cleaned]);
    }

    setChannelDraft("");
    setChannelResults([]);
  }

  function removeNewProfileChannel(value: string) {
    setNewProfileChannels(newProfileChannels.filter((channel) => normalize(channel) !== normalize(value)));
  }

  function addChannel(value: string) {
    const cleaned = value.replace(/\s+/g, " ").trim();

    if (cleaned.length > 1 && !subscriptions.has(normalize(cleaned))) {
      setChannels([...channels, cleaned]);
    }

    setChannelDraft("");
    setChannelResults([]);
  }

  function removeChannel(value: string) {
    setChannels(channels.filter((channel) => normalize(channel) !== normalize(value)));
  }

  const queue = usePlaybackQueue(profileId);
  const queuedVideoIds = useMemo(
    () => new Set((queue.snapshot?.items || []).map((video) => video.id)),
    [queue.snapshot]
  );

  function openVideo(video: FeedVideo) {
    setActiveVideo(video);
    writeRoute(section, video.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Keep the queue cursor in sync when the user jumps to a queued video.
    void queue.setCurrentIfQueued(video.id);
  }

  function dismissFeedbackNotice() {
    if (feedbackNoticeTimerRef.current !== null) {
      window.clearTimeout(feedbackNoticeTimerRef.current);
      feedbackNoticeTimerRef.current = null;
    }
    setFeedbackNotice(null);
  }

  function showSaveNotice(video: FeedVideo) {
    if (saveNoticeTimerRef.current !== null) {
      window.clearTimeout(saveNoticeTimerRef.current);
    }
    setSaveNotice({ video, key: Date.now() });
    saveNoticeTimerRef.current = window.setTimeout(() => {
      setSaveNotice(null);
      saveNoticeTimerRef.current = null;
    }, 7000);
  }

  function openOrganizeDialog(video: FeedVideo) {
    if (saveNoticeTimerRef.current !== null) {
      window.clearTimeout(saveNoticeTimerRef.current);
      saveNoticeTimerRef.current = null;
    }
    setSaveNotice(null);
    const savedItem = savedItems.find((item) => item.video.id === video.id);
    setSaveDialog({
      videoId: video.id,
      folderIds: savedItem?.folders.map((folder) => folder.id) || [],
      tagIds: savedItem?.tags.map((tag) => tag.id) || [],
      note: savedItem?.note || ""
    });
  }

  function showFeedbackNotice(notice: NonNullable<typeof feedbackNotice>) {
    if (feedbackNoticeTimerRef.current !== null) {
      window.clearTimeout(feedbackNoticeTimerRef.current);
    }
    setFeedbackNotice(notice);
    feedbackNoticeTimerRef.current = window.setTimeout(() => {
      setFeedbackNotice(null);
      feedbackNoticeTimerRef.current = null;
    }, notice.kind === "error" ? 8000 : 7000);
  }

  async function submitContentFeedback(action: CardFeedbackAction, video: FeedVideo) {
    if (!profileId || feedbackPending) {
      return;
    }

    const targetPool = searchResults ?? homeVideos;
    const removedIds = feedbackTargetIds(action, video, targetPool);
    const visibleIds = new Set(removedIds.length > 0 ? removedIds : [video.id]);
    const isWatchTarget = activeVideo?.id === video.id;
    const wasWatchingMutedChannel = isWatchTarget && action === "muteChannel";

    // Optimistic removal: cards vanish immediately and the watch view steps aside.
    feedbackSnapshotRef.current = {
      videos: feed?.videos ?? [],
      search: searchResults,
      active: activeVideo
    };
    if (removedIds.length > 0) {
      const removed = new Set(removedIds);
      setFeed((current) =>
        current ? { ...current, videos: current.videos.filter((item) => !removed.has(item.id)) } : current
      );
      setSearchResults((current) =>
        current ? current.filter((item) => !removed.has(item.id)) : current
      );
    }
    if (wasWatchingMutedChannel) {
      const nextUp = sideVideos.find((item) => !channelMatchesVideo(item, video)) || null;
      setActiveVideo(nextUp);
      if (nextUp) {
        writeRoute(section, nextUp.id);
      } else {
        writeRoute(section);
      }
    } else if (isWatchTarget && action !== "muteChannel") {
      // Keep playback open for single-video feedback; only recommendations change.
    }

    setFeedbackPending({ action, videoId: video.id });
    setError("");

    try {
      const response = await authedFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFeedbackPayload(profileId, action, video))
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.error === "string" && data.error ? data.error : "Could not save feedback.");
      }

      const copy = feedbackToastCopy(action, video, visibleIds.size);
      showFeedbackNotice({
        kind: action === "muteChannel" ? "muted" : "removed",
        title: copy.title,
        detail: copy.detail,
        action,
        video,
        removedIds: [...visibleIds],
        key: Date.now()
      });

      // Refresh feed state so the pool refills behind the optimistic removal.
      if (searchResults !== null) {
        const query = (searchedQuery || searchQuery).trim();
        if (query) {
          await searchForVideos(query);
        }
      } else if (section === "home") {
        await requestFeed({ resetFeed: true, buildIfMissing: true });
      }
    } catch (caught) {
      // Recovery: restore the exact pre-feedback view and surface a retry.
      const snapshot = feedbackSnapshotRef.current;
      if (snapshot) {
        setFeed((current) => (current ? { ...current, videos: snapshot.videos } : current));
        setSearchResults(snapshot.search);
        if (activeVideo?.id !== snapshot.active?.id) {
          setActiveVideo(snapshot.active);
          if (snapshot.active) {
            writeRoute(section, snapshot.active.id);
          }
        }
      }
      const message = caught instanceof Error ? caught.message : "Could not save feedback.";
      showFeedbackNotice({
        kind: "error",
        title: "Feedback not saved",
        detail: `${message} Your feed was restored — try again.`,
        action,
        video,
        key: Date.now()
      });
    } finally {
      feedbackSnapshotRef.current = null;
      setFeedbackPending(null);
    }
  }

  const handleEnqueueVideo = useCallback(
    (video: FeedVideo) => {
      const wasEmpty = (queue.snapshot?.items.length ?? 0) === 0;
      void queue.enqueue(video);
      if (wasEmpty) setQueueOpen(true);
      else setQueueNotice(true);
    },
    [queue]
  );

  const handlePlayNextQueued = useCallback(async () => {
    const transition = await queue.advanceNext();
    if (transition?.kind === "advanced" && transition.video) {
      setActiveVideo(transition.video);
      writeRoute(section, transition.video.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [queue, section]);

  /** Resolve a YouTube ENDED event: autoplay advances, otherwise playback stays stopped. */
  const handlePlayerEnded = useCallback(async () => {
    const transition = await queue.resolveEnded();
    if (transition?.kind === "advanced" && transition.video) {
      setActiveVideo(transition.video);
      writeRoute(section, transition.video.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [queue, section]);

  const handleToggleQueueAutoplay = useCallback(
    (enabled: boolean) => {
      void queue.setAutoplay(enabled);
    },
    [queue]
  );

  const handleMoveQueuedVideo = useCallback(
    (videoId: string, toIndex: number) => {
      void queue.move(videoId, toIndex);
    },
    [queue]
  );

  const handleRemoveQueuedVideo = useCallback(
    (videoId: string) => {
      void queue.remove(videoId);
    },
    [queue]
  );

  const handleClearQueue = useCallback(() => {
    void queue.clear();
  }, [queue]);

  const handleQueueRetry = useCallback(() => {
    void queue.refresh();
  }, [queue]);

  return (
    <main className="app-shell">
      <TopBar
        activeProfile={activeProfile}
        profiles={profiles}
        activeSection={section}
        showProfileMenu={showProfileMenu}
        developerAnalytics={settings.developerAnalytics === true}
        searchQuery={searchQuery}
        searching={searching}
        refreshing={isRefreshing}
        onHome={openHome}
        onSaved={openSaved}
        onHistory={openHistory}
        onSearchQueryChange={handleSearchQueryChange}
        onSearch={submitSearch}
        onRefresh={() => void refreshVideos()}
        onToggleProfileMenu={() => setShowProfileMenu(!showProfileMenu)}
        onSelectProfile={(nextProfileId) => {
          resetSearchRequest();
          feedRequestIdRef.current += 1;
          setLoading(false);
          setIsBuilding(false);
          setProfileId(nextProfileId);
          const nextProfile = profiles.find((profile) => profile.id === nextProfileId);
          const cachedFeed = readCachedFeed(nextProfileId);
          const nextTags = nextProfile?.tags || [];
          const nextChannels = nextProfile?.channels || [];
          const paintCache =
            cachedFeed && feedPreferencesMatch(cachedFeed, nextTags, nextChannels)
              ? cachedFeed
              : null;
          setFeed(paintCache);
          setSearchResults(null);
          setSearchedQuery("");
          setTags(nextTags);
          setChannels(nextChannels);
          setActiveVideo(null);
          setSection("home");
          writeRoute("home");
          setSavedVideos([]);
          setHistoryVideos([]);
          setSavedVideoIds(new Set());
          setLikedVideoIds(new Set());
          void loadSavedVideos(nextProfileId).catch((caught) =>
            setError(caught instanceof Error ? caught.message : "Could not load saved videos.")
          );
          void loadLikedVideos(nextProfileId).catch((caught) =>
            setError(caught instanceof Error ? caught.message : "Could not load liked videos.")
          );
          if (nextTags.length > 0 || nextChannels.length > 0) {
            void requestFeed({
              nextProfileId,
              nextTags,
              nextChannels,
              resetFeed: true,
              buildIfMissing: true
            });
          }
          setShowProfileMenu(false);
        }}
        onManageProfiles={() => {
          setManageProfiles(true);
          setShowProfileMenu(false);
        }}
        onOpenSettings={() => {
          setSettingsError("");
          setShowProfileMenu(false);
          setShowSettings(true);
        }}
        queueCount={queue.snapshot?.items.length ?? 0}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen((open) => !open)}
      />

      {queueOpen && (
        <aside id="global-queue" className="global-queue" aria-label="Queue drawer">
          <QueuePanel
            snapshot={queue.snapshot}
            loading={queue.loading}
            mutating={queue.mutating}
            error={queue.error}
            activeVideoId={activeVideo?.id || ""}
            onSelectVideo={openVideo}
            onMove={handleMoveQueuedVideo}
            onRemove={handleRemoveQueuedVideo}
            onClear={handleClearQueue}
            onToggleAutoplay={handleToggleQueueAutoplay}
            onRetry={handleQueueRetry}
            onClose={() => setQueueOpen(false)}
          />
        </aside>
      )}

      {queueNotice && !queueOpen && (
        <div className="feedback-toast queued" role="status" aria-live="polite"><div className="feedback-toast-copy"><strong>Added to queue</strong></div><button className="feedback-toast-retry" onClick={() => { setQueueNotice(false); setQueueOpen(true); }}>View queue</button><button className="feedback-toast-dismiss" aria-label="Dismiss queue notice" onClick={() => setQueueNotice(false)}><X size={15} /></button></div>
      )}

      {saveNotice && !saveDialog && (
        <div className="feedback-toast saved" role="status" aria-live="polite">
          <span className="feedback-toast-icon" aria-hidden="true">
            <Bookmark size={17} />
          </span>
          <div className="feedback-toast-copy">
            <strong>Saved</strong>
            <span>“{saveNotice.video.title}” is in your saved library.</span>
          </div>
          <button
            type="button"
            className="feedback-toast-retry"
            onClick={() => openOrganizeDialog(saveNotice.video)}
          >
            Organize
          </button>
          <button
            type="button"
            className="feedback-toast-dismiss"
            onClick={() => {
              if (saveNoticeTimerRef.current !== null) {
                window.clearTimeout(saveNoticeTimerRef.current);
                saveNoticeTimerRef.current = null;
              }
              setSaveNotice(null);
            }}
            aria-label="Dismiss save notice"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {feedbackNotice && (
        <div
          className={`feedback-toast ${feedbackNotice.kind}`}
          role={feedbackNotice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="feedback-toast-icon" aria-hidden="true">
            {feedbackNotice.kind === "error" ? (
              <X size={17} />
            ) : feedbackNotice.action === "notInterested" ? (
              <ThumbsDown size={17} />
            ) : feedbackNotice.action === "hideVideo" ? (
              <EyeOff size={17} />
            ) : feedbackNotice.action === "muteChannel" ? (
              <BellOff size={17} />
            ) : (
              <BellOff size={17} />
            )}
          </span>
          <div className="feedback-toast-copy">
            <strong>{feedbackNotice.title}</strong>
            <span>{feedbackNotice.detail}</span>
          </div>
          {feedbackNotice.kind === "error" && feedbackNotice.action && feedbackNotice.video ? (
            <button
              type="button"
              className="feedback-toast-retry"
              onClick={() => {
                const retry = feedbackNotice.video;
                const retryAction = feedbackNotice.action;
                dismissFeedbackNotice();
                if (retry && retryAction) {
                  void submitContentFeedback(retryAction, retry);
                }
              }}
            >
              Try again
            </button>
          ) : null}
          <button type="button" className="feedback-toast-dismiss" onClick={dismissFeedbackNotice} aria-label="Dismiss feedback notice">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {feedbackPending && (
        <p className="feedback-pending sr-only" role="status" aria-live="polite">
          <LoaderCircle size={14} aria-hidden="true" className="spinner" />
          Saving feedback…
        </p>
      )}

      {activeVideo && (
        <WatchView
          key={activeVideo.id}
          activeVideo={activeVideo}
          sideVideos={sideVideos}
          loadingFeed={loading}
          canLoadMoreSideVideos={canAskForMore}
          subscriptions={subscriptions}
          videoRef={videoRef}
          savedVideoIds={savedVideoIds}
          likedVideoIds={likedVideoIds}
          profileId={profileId}
          feedbackPendingAction={feedbackPending?.videoId === activeVideo.id ? feedbackPending.action : null}
          onSelectVideo={openVideo}
          onLoadMoreSideVideos={() => requestFeed()}
          onSaveVideo={saveVideo}
          onLikeVideo={likeVideo}
          onFeedback={submitContentFeedback}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
          onPlaybackStateChange={(playing) => {
            isPlayingRef.current = playing;
          }}
          onTimeUpdate={handleWatchTimeUpdate}
          queuedVideoIds={queuedVideoIds}
          onEnqueueVideo={handleEnqueueVideo}
          onVideoEnded={handlePlayerEnded}
        />
      )}

      {error && !manageProfiles && !needsProfile && <p className="error page-error">{error}</p>}

      {booted && section === "saved" && !activeVideo && searchResults === null && (
        <SavedWorkspace
          items={savedItems}
          folders={savedFolders}
          tags={savedTags}
          savedVideoIds={savedVideoIds}
          loading={savedCollections.state.loading && savedItems.length === 0}
          refreshing={savedCollections.state.loading && savedItems.length > 0}
          error={savedCollections.state.error}
          filter={savedFilter}
          onFilterChange={setSavedFilter}
          onSelectVideo={openVideo}
          onToggleSave={saveVideo}
          onUpdateItem={updateSavedItem}
          onCreateFolder={(name) => savedCollectionMutation("create-folder", { name })}
          onRenameFolder={(folderId, name) => savedCollectionMutation("rename-folder", { folderId, name })}
          onDeleteFolder={(folderId) => savedCollectionMutation("delete-folder", { folderId })}
          onCreateTag={(name) => savedCollectionMutation("create-tag", { name })}
          onRenameTag={(tagId, name) => savedCollectionMutation("rename-tag", { tagId, name })}
          onDeleteTag={(tagId) => savedCollectionMutation("delete-tag", { tagId })}
          onRetry={() => {
            void loadSavedVideos(profileId).catch((caught) =>
              setError(caught instanceof Error ? caught.message : "Could not load saved videos.")
            );
          }}
        />
      )}

      {saveDialog && (
        <OrganizeDialog
          draft={saveDialog}
          folders={savedFolders}
          tags={savedTags}
          title="Save to a collection"
          submitLabel="Done"
          onClose={() => setSaveDialog(null)}
          onCreateFolder={(name) => savedCollectionMutation("create-folder", { name })}
          onCreateTag={(name) => savedCollectionMutation("create-tag", { name })}
          onSave={async (folderIds, tagIds, note) => {
            await updateSavedItem(saveDialog.videoId, { folderIds, tagIds, note });
            setSaveDialog(null);
          }}
        />
      )}

      {booted && !searching && searchResults === null && section !== "saved" && (visibleVideos.length > 0 || (loading && section === "home")) && !activeVideo && (
        <FeedView
          title={searchResults !== null ? `Search results for “${searchedQuery || searchQuery.trim()}”` : section === "history" ? "History" : ""}
          subtitle={
            searchResults !== null
              ? "Results are filtered against this profile’s interests."
              : section === "history"
              ? "Videos that crossed your watch threshold."
              : ""
          }
          videos={visibleVideos}
          subscriptions={subscriptions}
          savedVideoIds={savedVideoIds}
          likedVideoIds={likedVideoIds}
          queuedVideoIds={queuedVideoIds}
          loading={searchResults !== null ? loadingSearchMore : loading}
          isBuilding={isBuilding}
          canAskForMore={searchResults !== null ? Boolean(searchCursor) : canAskForMore}
          profileName={activeProfile?.name || profileName}
          tags={tags}
          channels={channels}
          loadingLabel={buildingLabel}
          onLoadMore={() => searchResults !== null ? void loadMoreSearch() : void requestFeed()}
          onSelectVideo={openVideo}
          onSaveVideo={saveVideo}
          onLikeVideo={likeVideo}
          onFeedback={searchResults !== null || section === "home" ? submitContentFeedback : undefined}
          feedbackPendingVideoId={feedbackPending?.videoId ?? null}
          feedbackPendingAction={feedbackPending?.action ?? null}
          onEnqueueVideo={handleEnqueueVideo}
          onVideoImpression={section === "home" ? recordVideoImpression : undefined}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
        />
      )}

      {booted && !searching && searchResults === null && section === "history" && visibleVideos.length === 0 && !activeVideo && (
        <p className="empty-state">No watched videos yet.</p>
      )}

      {booted && searchResults !== null && searchResults.length === 0 && !searching && !activeVideo && (
        <p className="empty-state">No results matched this profile’s interests.</p>
      )}

      {booted && searching && !activeVideo && (
        <p className="empty-state">Searching...</p>
      )}

      {(needsProfile || manageProfiles) && (
        <ProfileModal
          manageProfiles={manageProfiles}
          feedOpen={Boolean(feed)}
          profiles={profiles}
          profileName={profileName}
          tags={newProfileTags}
          channels={newProfileChannels}
          tagDraft={tagDraft}
          channelDraft={channelDraft}
          channelResults={channelResults}
          isSearchingChannels={isSearchingChannels}
          loading={loading}
          loadingLabel={buildingLabel}
          error={error}
          needsOpenRouterKey={needsOpenRouterKey}
          settings={settings}
          topicSuggestions={starterTagSuggestions}
          onClose={() => setManageProfiles(false)}
          onSubmit={createProfileAndBuild}
          onSettingsChange={setSettings}
          onProfileNameChange={setProfileName}
          onTagDraftChange={setTagDraft}
          onChannelDraftChange={setChannelDraft}
          onAddTag={addNewProfileTag}
          onRemoveTag={(value) => setNewProfileTags(newProfileTags.filter((tag) => tag !== value))}
          onAddChannel={addNewProfileChannel}
          onRemoveChannel={removeNewProfileChannel}
          onDeleteProfile={deleteProfile}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          saving={savingSettings}
          error={settingsError}
          onClose={() => {
            setShowSettings(false);
            setSettingsError("");
          }}
          onSubmit={saveSettings}
          onChange={setSettings}
        />
      )}
    </main>
  );
}

function orderedSideVideos(
  videos: FeedVideo[],
  activeVideo: FeedVideo | null,
  upNextByVideoId: Record<string, string[]> | undefined
) {
  const candidates = videos.filter((video) => video.id !== activeVideo?.id);
  const orderedIds = activeVideo ? upNextByVideoId?.[activeVideo.id] : null;

  if (!orderedIds) {
    return candidates;
  }

  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return [...candidates].sort(
    (left, right) =>
      (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

function isStarterTag(tag: string) {
  return starterTagSuggestions.some((starterTag) => normalize(starterTag) === normalize(tag));
}

function readSavedState() {
  try {
    const raw = window.localStorage.getItem(clientStateKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    return {
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag: unknown) => typeof tag === "string" && !isStarterTag(tag))
        : [],
      channels: Array.isArray(parsed.channels)
        ? parsed.channels.filter((channel: unknown) => typeof channel === "string")
        : []
    };
  } catch {
    return null;
  }
}

function feedCacheKey(profileId: string) {
  return `${feedCachePrefix}.${profileId}`;
}

function feedPreferencesMatch(feed: CachedFeed, tags: string[], channels: string[]) {
  return sameNormalizedValues(feed.tags || [], tags) && sameNormalizedValues(feed.channels || [], channels);
}

function sameNormalizedValues(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedRight = new Set(right.map(normalize));
  return left.every((value) => normalizedRight.has(normalize(value)));
}

function readCachedFeed(profileId: string) {
  try {
    const raw = window.localStorage.getItem(feedCacheKey(profileId));

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.videos)) {
      return null;
    }

    return {
      ...parsed,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag: unknown) => typeof tag === "string") : [],
      channels: Array.isArray(parsed.channels)
        ? parsed.channels.filter((channel: unknown) => typeof channel === "string")
        : [],
      videos: parsed.videos.filter((video: unknown) => Boolean(video && typeof video === "object"))
    } as CachedFeed;
  } catch {
    return null;
  }
}

function writeCachedFeed(profileId: string, feed: FeedResponse) {
  try {
    window.localStorage.setItem(
      feedCacheKey(profileId),
      JSON.stringify({
        ...feed,
        videos: feed.videos,
        cachedAt: Date.now()
      })
    );
  } catch {
    // The feed still works if the browser storage quota is full.
  }
}

function clearCachedFeed(profileId: string) {
  if (!profileId) {
    return;
  }

  try {
    window.localStorage.removeItem(feedCacheKey(profileId));
  } catch {
    // Ignore storage failures.
  }
}

function readStashedActiveVideo(videoId: string | null) {
  try {
    if (!videoId) {
      return null;
    }

    const raw = window.sessionStorage.getItem(activeVideoSessionKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const video = parsed?.video;

    if (!video || typeof video !== "object" || typeof video.id !== "string" || video.id !== videoId) {
      return null;
    }

    return sanitizeFeedVideo(video);
  } catch {
    return null;
  }
}

function writeStashedActiveVideo(video: FeedVideo) {
  try {
    window.sessionStorage.setItem(
      activeVideoSessionKey,
      JSON.stringify({
        savedAt: Date.now(),
        video
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function clearStashedActiveVideo() {
  try {
    window.sessionStorage.removeItem(activeVideoSessionKey);
  } catch {
    // Ignore storage failures.
  }
}

async function fetchVideoInfo(profileId: string, videoId: string) {
  try {
    const response = await authedFetch(
      `/api/video-info?profileId=${encodeURIComponent(profileId)}&videoId=${encodeURIComponent(videoId)}`
    );
    const data = await response.json();

    if (!response.ok || !data.video) {
      return null;
    }

    return sanitizeFeedVideo(data.video);
  } catch {
    return null;
  }
}

async function reportWatchEvent(
  profileId: string,
  video: FeedVideo,
  watchedSeconds: number,
  durationSeconds: number
) {
  const safeDurationSeconds = Math.max(1, Math.round(durationSeconds));
  const response = await authedFetch("/api/watch-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId,
      video,
      watchedSeconds,
      durationSeconds: safeDurationSeconds
    }),
    keepalive: true
  });

  if (!response.ok) {
    return false;
  }

  const data = await response.json();
  return data.saved === true;
}

function sanitizeFeedVideo(video: unknown): FeedVideo | null {
  if (!video || typeof video !== "object") {
    return null;
  }

  const value = video as Record<string, unknown>;

  if (typeof value.id !== "string" || value.id.trim() === "") {
    return null;
  }

  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "Untitled video",
    author: typeof value.author === "string" ? value.author : "Unknown channel",
    duration: readVideoDuration(value),
    query: typeof value.query === "string" ? value.query : "Watch",
    channelAvatarUrl: typeof value.channelAvatarUrl === "string" ? value.channelAvatarUrl : undefined,
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : undefined,
    thumbnailCacheUrl: typeof value.thumbnailCacheUrl === "string" ? value.thumbnailCacheUrl : undefined,
    publishedText: typeof value.publishedText === "string" ? value.publishedText : undefined,
    publishedAt: typeof value.publishedAt === "number" ? value.publishedAt : undefined,
    viewCount: typeof value.viewCount === "number" ? value.viewCount : undefined,
    channelKey: typeof value.channelKey === "string" ? value.channelKey : undefined,
    channelId: typeof value.channelId === "string" ? value.channelId : undefined,
    parent_video_id: typeof value.parent_video_id === "string" ? value.parent_video_id : undefined,
    parent_title: typeof value.parent_title === "string" ? value.parent_title : undefined,
    parent_author: typeof value.parent_author === "string" ? value.parent_author : undefined,
    recommendation_depth: typeof value.recommendation_depth === "number" ? value.recommendation_depth : undefined,
    sourceNodeId:
      value.sourceNodeId === "tagSearch" ||
      value.sourceNodeId === "channelVideos" ||
      value.sourceNodeId === "relatedVideos"
        ? value.sourceNodeId
        : undefined,
    sourceNodeLabel: typeof value.sourceNodeLabel === "string" ? value.sourceNodeLabel : undefined,
    impressionCount: typeof value.impressionCount === "number" ? value.impressionCount : undefined,
    liked: typeof value.liked === "boolean" ? value.liked : undefined,
    clicked: typeof value.clicked === "boolean" ? value.clicked : undefined,
    ignoreCount: typeof value.ignoreCount === "number" ? value.ignoreCount : undefined,
    watchTimeRatio: typeof value.watchTimeRatio === "number" ? value.watchTimeRatio : undefined
  };
}

function parseDurationToSeconds(value: string) {
  if (!value) {
    return 0;
  }

  const parts = value
    .split(":")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) {
    return 0;
  }

  if (parts.length === 1) {
    return Math.max(0, Math.floor(parts[0]));
  }

  if (parts.length === 2) {
    return Math.max(0, Math.floor(parts[0] * 60 + parts[1]));
  }

  return Math.max(0, Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]));
}

function readVideoDuration(value: Record<string, unknown>) {
  if (typeof value.duration === "string" && value.duration.trim() !== "") {
    return value.duration;
  }

  return durationFromNumberishFields(value);
}

function durationFromNumberishFields(value: Record<string, unknown>) {
  const candidates = [
    value.durationSeconds,
    value.duration_seconds,
    value.lengthSeconds,
    value.length_seconds
  ];

  for (const candidate of candidates) {
    const seconds = typeof candidate === "number" ? candidate : Number(candidate);

    if (Number.isFinite(seconds) && seconds > 0) {
      return secondsToDuration(seconds);
    }
  }

  return "";
}

function secondsToDuration(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readRouteFromUrl(): { section: Section; videoId: string | null } {
  const params = new URLSearchParams(window.location.search);
  const sectionParam = params.get("section");
  const section: Section =
    sectionParam === "saved" || sectionParam === "history" ? sectionParam : "home";

  return {
    section,
    videoId: params.get("video")
  };
}

function writeRoute(section: Section, videoId?: string) {
  try {
    const params = new URLSearchParams();

    if (section !== "home") {
      params.set("section", section);
    }

    if (videoId) {
      params.set("video", videoId);
    }

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;

    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  } catch {
    // Ignore pushState errors in restricted webview environments
  }
}
