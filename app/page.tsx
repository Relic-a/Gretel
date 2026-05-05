"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { MediaPlayerClass } from "dashjs";

import { ProfileModal } from "./components/ProfileModal";
import { TopBar } from "./components/TopBar";
import { FeedView } from "./components/FeedView";
import { WatchView } from "./components/WatchView";
import { normalize } from "./components/video-utils";
import type { ChannelResult, FeedResponse, FeedVideo, Profile, PublicGretelConfig } from "./types";

type DashPlayer = MediaPlayerClass & {
  getBitrateInfoListFor: (mediaType: "video") => Array<{ height?: number; bitrate: number }>;
  setQualityFor: (mediaType: "video", quality: number, forceReplace?: boolean) => void;
};

const clientStateKey = "gretel.clientState.v2";
const feedCachePrefix = "gretel.feedCache.v1";
const starterTags = ["AI engineering", "TypeScript", "product design"];
type Section = "home" | "saved" | "history";

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [tags, setTags] = useState<string[]>(starterTags);
  const [channels, setChannels] = useState<string[]>([]);
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
  const [quality, setQuality] = useState("auto");
  const [qualityOptions, setQualityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedEnd, setFeedEnd] = useState(false);
  const [booted, setBooted] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [manageProfiles, setManageProfiles] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<DashPlayer | null>(null);
  const pendingVideoIdRef = useRef<string | null>(null);
  const subscriptions = useMemo(
    () => new Set(channels.map((channel) => normalize(channel))),
    [channels]
  );
  const activeProfile = profiles.find((profile) => profile.id === profileId);
  const needsProfile = booted && profiles.length === 0 && !feed;
  const homeVideos = feed?.videos || [];
  const visibleVideos =
    section === "saved" ? savedVideos : section === "history" ? historyVideos : homeVideos;
  const sideVideos = orderedSideVideos(visibleVideos, activeVideo, feed?.upNextByVideoId).slice(0, 12);
  const canAskForMore = section === "home" && Boolean(feed) && !loading && !feedEnd;

  useEffect(() => {
    let disposed = false;

    async function boot() {
      const saved = readSavedState();
      const route = readRouteFromUrl();
      const [selectedProfileId] = await Promise.all([
        loadProfiles(saved?.profileId),
        loadPublicConfig()
      ]);

      if (disposed) {
        return;
      }

      setTags(saved?.tags?.length ? saved.tags : starterTags);
      setChannels(saved?.channels || []);
      setBooted(true);
      setSection(route.section);
      pendingVideoIdRef.current = route.videoId;

      if (selectedProfileId) {
        const cachedFeed = readCachedFeed(selectedProfileId);

        if (cachedFeed) {
          setFeed(cachedFeed);
        }

        await loadSavedVideos(selectedProfileId);
        await loadLikedVideos(selectedProfileId);

        if (route.section === "history") {
          await loadHistoryVideos(selectedProfileId);
        }
      }

      if (selectedProfileId && (saved?.tags?.length || saved?.channels?.length)) {
        await requestFeed({
          nextProfileId: selectedProfileId,
          nextTags: saved?.tags?.length ? saved.tags : starterTags,
          nextChannels: saved?.channels || [],
          forceExpansion: true
        });
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
      pendingVideoIdRef.current = route.videoId;
      setActiveVideo(null);
      setSection(route.section);

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

    const matchingVideo = visibleVideos.find((video) => video.id === pendingVideoId);

    if (matchingVideo) {
      setActiveVideo(matchingVideo);
      pendingVideoIdRef.current = null;
    }
  }, [booted, visibleVideos]);

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
    if (!activeVideo || !videoRef.current) {
      return;
    }

    let disposed = false;
    const video = activeVideo;
    setQuality("auto");
    setQualityOptions([]);

    async function loadPlayer() {
      const dashModule = await import("dashjs");
      const dashjs = dashModule as typeof import("dashjs");

      if (disposed || !videoRef.current) {
        return;
      }

      playerRef.current?.destroy();
      const player = dashjs.MediaPlayer().create() as DashPlayer;
      player.updateSettings({
        streaming: {
          abr: { autoSwitchBitrate: { video: true, audio: true } }
        }
      });
      player.initialize(
        videoRef.current,
        `/api/videos/${video.id}/stream?profileId=${encodeURIComponent(profileId)}`,
        true
      );
      player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
        const bitrates = player.getBitrateInfoListFor("video");
        setQualityOptions(
          bitrates.map((bitrate, index) => ({
            value: String(index),
            label: bitrate.height ? `${bitrate.height}p` : `${Math.round(bitrate.bitrate / 1000)} kbps`
          }))
        );
      });
      player.on(dashjs.MediaPlayer.events.ERROR, () => {
        setError("Could not open this video stream.");
      });
      playerRef.current = player;
    }

    loadPlayer().catch(() => setError("Could not open this video stream."));

    return () => {
      disposed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [activeVideo, profileId]);

  useEffect(() => {
    if (!activeVideo || !profileId || !videoRef.current) {
      return;
    }

    const element = videoRef.current;
    let sent = false;

    async function reportWatch() {
      if (sent || !Number.isFinite(element.duration) || element.duration <= 0) {
        return;
      }

      const watchedSeconds = Math.max(element.currentTime, 0);
      const watchedRatio = watchedSeconds / element.duration;

      const saveThreshold = config?.learning.watchSaveThreshold ?? 0.5;

      if (watchedRatio < saveThreshold && !element.ended) {
        return;
      }

      sent = true;

      try {
        const response = await fetch("/api/watch-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId,
            video: activeVideo,
            watchedSeconds,
            durationSeconds: element.duration
          })
        });
        const data = await response.json();
        sent = data.saved === true;

        if (sent && section === "history") {
          await loadHistoryVideos(profileId);
        }
      } catch {
        sent = false;
      }
    }

    element.addEventListener("timeupdate", reportWatch);
    element.addEventListener("ended", reportWatch);

    return () => {
      element.removeEventListener("timeupdate", reportWatch);
      element.removeEventListener("ended", reportWatch);
    };
  }, [activeVideo, config?.learning.watchSaveThreshold, profileId, section]);

  useEffect(() => {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    if (quality === "auto") {
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true } } }
      });
      return;
    }

    player.updateSettings({
      streaming: { abr: { autoSwitchBitrate: { video: false } } }
    });
    player.setQualityFor("video", Number(quality), true);
  }, [quality]);

  useEffect(() => {
    if (channelDraft.trim().length < 2) {
      setChannelResults([]);
      return;
    }

    let ignore = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
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
    const response = await fetch("/api/profiles");
    const data = await response.json();
    const nextProfiles = data.profiles || [];
    const selected =
      nextProfiles.find((profile: Profile) => profile.id === nextProfileId) || nextProfiles[0];

    setProfiles(nextProfiles);
    setProfileId(selected?.id || "");
    return selected?.id || "";
  }

  async function loadPublicConfig() {
    const response = await fetch("/api/config");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load Gretel config.");
    }

    setConfig(data);
  }

  async function createProfileAndBuild(event?: FormEvent) {
    event?.preventDefault();

    if (!profileName.trim()) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not add this profile.");
      }

      setProfiles(data.profiles || []);
      setProfileId(data.profileId || "");
      setProfileName("");
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

      await requestFeed({
        nextProfileId: data.profileId || "",
        nextTags: tags,
        nextChannels: channels,
        forceExpansion: true
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this profile.");
      setLoading(false);
    }
  }

  async function deleteProfile(id: string) {
    const response = await fetch("/api/profiles", {
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
    await requestFeed({ forceExpansion: true });
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

    const response = await fetch(`/api/saved-videos?profileId=${encodeURIComponent(nextProfileId)}`);
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

    const response = await fetch(`/api/liked-videos?profileId=${encodeURIComponent(nextProfileId)}`);
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

    const response = await fetch(`/api/history?profileId=${encodeURIComponent(nextProfileId)}`);
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

    const response = await fetch("/api/saved-videos", {
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

    const response = await fetch("/api/liked-videos", {
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

  async function requestFeed(input: {
    nextProfileId?: string;
    nextTags?: string[];
    nextChannels?: string[];
    forceExpansion?: boolean;
  } = {}) {
    const nextTags = input.nextTags || tags;
    const nextChannels = input.nextChannels || channels;
    const nextProfileId = input.nextProfileId || profileId;

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: nextTags,
          channels: nextChannels,
          profileId: nextProfileId,
          forceExpansion: input.forceExpansion === true,
          servingOnly: input.forceExpansion !== true
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not build this feed.");
      }

      setFeed((current) => {
        if (!input.forceExpansion && current?.videos?.length) {
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
      setActiveVideo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build this feed.");
    } finally {
      setLoading(false);
    }
  }

  function addTag(value: string) {
    const cleaned = value.replace(/\s+/g, " ").trim();

    if (cleaned.length > 1 && !tags.some((tag) => normalize(tag) === normalize(cleaned))) {
      setTags([...tags, cleaned]);
    }

    setTagDraft("");
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
          setProfileId(nextProfileId);
          setFeed(readCachedFeed(nextProfileId));
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
          setShowProfileMenu(false);
        }}
        onManageProfiles={() => {
          setManageProfiles(true);
          setShowProfileMenu(false);
        }}
      />

      {feed && activeVideo && (
        <WatchView
          activeVideo={activeVideo}
          sideVideos={sideVideos}
          subscriptions={subscriptions}
          quality={quality}
          qualityOptions={qualityOptions}
          videoRef={videoRef}
          savedVideoIds={savedVideoIds}
          likedVideoIds={likedVideoIds}
          onSelectVideo={openVideo}
          onSaveVideo={saveVideo}
          onLikeVideo={likeVideo}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
          onQualityChange={setQuality}
        />
      )}

      {error && !manageProfiles && !needsProfile && <p className="error page-error">{error}</p>}

      {booted && (visibleVideos.length > 0 || (loading && section === "home")) && !activeVideo && (
        <FeedView
          title={section === "home" ? "Your Feed" : section === "saved" ? "Saved" : "History"}
          subtitle={
            section === "home"
              ? "AI-curated picks, personalized for your interests."
              : section === "saved"
                ? "Videos you saved for later."
                : "Videos that crossed your watch threshold."
          }
          videos={visibleVideos}
          subscriptions={subscriptions}
          savedVideoIds={savedVideoIds}
          likedVideoIds={likedVideoIds}
          loading={loading}
          canAskForMore={canAskForMore}
          onLoadMore={() => requestFeed({ forceExpansion: false })}
          onSelectVideo={openVideo}
          onSaveVideo={saveVideo}
          onLikeVideo={likeVideo}
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
          tags={tags}
          channels={channels}
          tagDraft={tagDraft}
          channelDraft={channelDraft}
          channelResults={channelResults}
          loading={loading}
          error={error}
          onClose={() => setManageProfiles(false)}
          onSubmit={createProfileAndBuild}
          onProfileNameChange={setProfileName}
          onTagDraftChange={setTagDraft}
          onChannelDraftChange={setChannelDraft}
          onAddTag={addTag}
          onRemoveTag={(value) => setTags(tags.filter((tag) => tag !== value))}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
          onDeleteProfile={deleteProfile}
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

function readSavedState() {
  try {
    const raw = window.localStorage.getItem(clientStateKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    return {
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag: unknown) => typeof tag === "string") : [],
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
      videos: parsed.videos.filter((video: unknown) => Boolean(video && typeof video === "object"))
    } as FeedResponse;
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
        videos: feed.videos.slice(0, 96),
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
