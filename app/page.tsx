"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProfileModal } from "./components/ProfileModal";
import { SettingsModal } from "./components/SettingsModal";
import { TopBar } from "./components/TopBar";
import { FeedView } from "./components/FeedView";
import { WatchView } from "./components/WatchView";
import { authedHeaders, normalize } from "./components/video-utils";
import type {
  ChannelResult,
  FeedResponse,
  FeedVideo,
  Profile,
  PublicGretelConfig,
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
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [config, setConfig] = useState<PublicGretelConfig | null>(null);
  const [section, setSection] = useState<Section>("home");
  const [savedVideos, setSavedVideos] = useState<FeedVideo[]>([]);
  const [historyVideos, setHistoryVideos] = useState<FeedVideo[]>([]);
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(new Set());
  const [activeVideo, setActiveVideo] = useState<FeedVideo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [buildingLabel, setBuildingLabel] = useState("");
  const [feedEnd, setFeedEnd] = useState(false);
  const [booted, setBooted] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [manageProfiles, setManageProfiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({});
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
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
  const visibleVideos =
    section === "saved" ? savedVideos : section === "history" ? historyVideos : homeVideos;
  const sideVideos = orderedSideVideos(visibleVideos, activeVideo, feed?.upNextByVideoId);
  const canAskForMore = section === "home" && Boolean(feed) && !loading && !feedEnd;

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
      const nextTags = cachedFeed?.tags?.length
        ? cachedFeed.tags
        : selectedProfile?.tags?.length
          ? selectedProfile.tags
          : saved?.profileId === selectedProfileId && saved.tags.length
          ? saved.tags
          : [];
      const nextChannels = cachedFeed?.channels?.length
        ? cachedFeed.channels
        : selectedProfile?.channels?.length
          ? selectedProfile.channels
          : saved?.profileId === selectedProfileId
            ? saved.channels
            : [];

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

      if (cachedFeed) {
        setFeed(cachedFeed);
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
            servingOnly: Boolean(cachedFeed)
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
    if (channelDraft.trim().length < 2) {
      setChannelResults([]);
      return;
    }

    let ignore = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await authedFetch(
          `/api/channels/search?q=${encodeURIComponent(channelDraft)}&profileId=${encodeURIComponent(profileId)}`
        );
        const data = await response.json();

        if (!ignore) {
          setChannelResults(data.channels || []);
        }
      } catch {
        if (!ignore) {
          setChannelResults([]);
        }
      }
    }, 300);

    return () => {
      ignore = true;
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

  async function buildFeed(event?: FormEvent) {
    event?.preventDefault();
    setSection("home");
    setActiveVideo(null);
    writeRoute("home");
    setFeedEnd(false);
    await requestFeed({ resetFeed: true });
  }

  async function openSaved() {
    setError("");
    setSection("saved");
    setActiveVideo(null);
    writeRoute("saved");
    try {
      await loadSavedVideos(profileId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load saved videos.");
    }
  }

  async function openHistory() {
    setError("");
    setSection("history");
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

    const response = await authedFetch(`/api/saved-videos?profileId=${encodeURIComponent(nextProfileId)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load saved videos.");
    }

    setSavedVideos(data.videos || []);
    setSavedVideoIds(new Set(data.savedVideoIds || []));
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

    const response = await authedFetch("/api/saved-videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        video,
        videoId: video.id,
        action: savedVideoIds.has(video.id) ? "unsave" : "save"
      })
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Could not save this video.");
      return;
    }

    setSavedVideos(data.videos || []);
    setSavedVideoIds(new Set(data.savedVideoIds || []));
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
    servingOnly?: boolean;
  } = {}) {
    const nextTags = input.nextTags || tags;
    const nextChannels = input.nextChannels || channels;
    const nextProfileId = input.nextProfileId || profileId;
    const resetFeed = input.resetFeed === true;
    const servingOnly = input.servingOnly ?? !resetFeed;
    const sessionId = resetFeed ? undefined : feed?.sessionId;
    const servedVideoIds = !resetFeed && feed?.videos?.length ? feed.videos.map((video) => video.id) : [];
    const requestId = feedRequestIdRef.current + 1;
    feedRequestIdRef.current = requestId;

    setError("");
    setLoading(true);
    if (resetFeed && !servingOnly) {
      setFeed(null);
      setFeedEnd(false);
    }

    try {
      const response = await authedFetch(servingOnly ? "/api/feed" : "/api/feed/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: nextTags,
          channels: nextChannels,
          profileId: nextProfileId,
          sessionId,
          servedVideoIds: servingOnly ? servedVideoIds : []
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not build this feed.");
      }

      if (requestId !== feedRequestIdRef.current) {
        return;
      }

      setFeed((current) => {
        if (!resetFeed && current?.videos?.length) {
          const seen = new Set(current.videos.map((video) => video.id));
          const nextVideos = (data.videos || []).filter((video: FeedVideo) => !seen.has(video.id));
          setFeedEnd(nextVideos.length === 0);

          return {
            ...data,
            videos: [...current.videos, ...nextVideos]
          };
        }

        setFeedEnd(false);
        return data;
      });
    } catch (caught) {
      if (requestId !== feedRequestIdRef.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : "Could not build this feed.");
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setLoading(false);
      }
    }
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

  function openVideo(video: FeedVideo) {
    setActiveVideo(video);
    writeRoute(section, video.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="app-shell">
      <TopBar
        activeProfile={activeProfile}
        profiles={profiles}
        activeSection={section}
        showProfileMenu={showProfileMenu}
        onHome={buildFeed}
        onSaved={openSaved}
        onHistory={openHistory}
        onToggleProfileMenu={() => setShowProfileMenu(!showProfileMenu)}
        onSelectProfile={(nextProfileId) => {
          feedRequestIdRef.current += 1;
          setLoading(false);
          setProfileId(nextProfileId);
          const nextProfile = profiles.find((profile) => profile.id === nextProfileId);
          const cachedFeed = readCachedFeed(nextProfileId);
          const nextTags = cachedFeed?.tags?.length ? cachedFeed.tags : nextProfile?.tags || [];
          const nextChannels = cachedFeed?.channels?.length ? cachedFeed.channels : nextProfile?.channels || [];
          setFeed(cachedFeed);
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
              servingOnly: Boolean(cachedFeed)
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
      />

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
          onSelectVideo={openVideo}
          onLoadMoreSideVideos={() => requestFeed()}
          onSaveVideo={saveVideo}
          onLikeVideo={likeVideo}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
          onPlaybackStateChange={(playing) => {
            isPlayingRef.current = playing;
          }}
          onTimeUpdate={handleWatchTimeUpdate}
        />
      )}

      {error && !manageProfiles && !needsProfile && <p className="error page-error">{error}</p>}

      {booted && (visibleVideos.length > 0 || (loading && section === "home")) && !activeVideo && (
        <FeedView
          title={section === "saved" ? "Saved" : section === "history" ? "History" : ""}
          subtitle={
            section === "saved"
              ? "Videos you saved for later."
              : section === "history"
              ? "Videos that crossed your watch threshold."
              : ""
          }
          videos={visibleVideos}
          subscriptions={subscriptions}
          savedVideoIds={savedVideoIds}
          likedVideoIds={likedVideoIds}
          loading={loading}
          canAskForMore={canAskForMore}
          profileName={activeProfile?.name || profileName}
          tags={tags}
          channels={channels}
          loadingLabel={buildingLabel}
          onLoadMore={() => requestFeed()}
          onSelectVideo={openVideo}
          onSaveVideo={saveVideo}
          onLikeVideo={likeVideo}
          onVideoImpression={section === "home" ? recordVideoImpression : undefined}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
        />
      )}

      {booted && section !== "home" && visibleVideos.length === 0 && !activeVideo && (
        <p className="empty-state">{section === "saved" ? "No saved videos yet." : "No watched videos yet."}</p>
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
}
