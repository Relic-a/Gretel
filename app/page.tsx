"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { MediaPlayerClass } from "dashjs";

type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  thumbnailUrl?: string;
  thumbnailCacheUrl?: string;
  publishedText?: string;
  publishedAt?: number;
  viewCount?: number;
  channelKey?: string;
};

type Profile = {
  id: string;
  name: string;
};

type ChannelResult = {
  id: string;
  name: string;
  thumbnailUrl?: string;
};

type FeedResponse = {
  profile: Profile;
  videos: FeedVideo[];
};

type DashPlayer = MediaPlayerClass & {
  getBitrateInfoListFor: (mediaType: "video") => Array<{ height?: number; bitrate: number }>;
  setQualityFor: (mediaType: "video", quality: number, forceReplace?: boolean) => void;
};

const clientStateKey = "gretel.clientState.v2";
const starterTags = ["AI engineering", "TypeScript", "product design"];

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
  const [activeVideo, setActiveVideo] = useState<FeedVideo | null>(null);
  const [quality, setQuality] = useState("auto");
  const [qualityOptions, setQualityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [booted, setBooted] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [manageProfiles, setManageProfiles] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<DashPlayer | null>(null);
  const subscriptions = useMemo(
    () => new Set(channels.map((channel) => normalize(channel))),
    [channels]
  );
  const activeProfile = profiles.find((profile) => profile.id === profileId);
  const needsProfile = booted && profiles.length <= 1 && channels.length === 0 && !feed;
  const sideVideos = feed?.videos.filter((video) => video.id !== activeVideo?.id).slice(0, 12) || [];

  useEffect(() => {
    let disposed = false;

    async function boot() {
      const saved = readSavedState();
      const selectedProfileId = await loadProfiles(saved?.profileId);

      if (disposed) {
        return;
      }

      setTags(saved?.tags?.length ? saved.tags : starterTags);
      setChannels(saved?.channels || []);
      setBooted(true);

      if ((saved?.tags?.length || saved?.channels?.length) && selectedProfileId) {
        await requestFeed({
          nextProfileId: selectedProfileId,
          nextTags: saved?.tags?.length ? saved.tags : starterTags,
          nextChannels: saved?.channels || [],
          forceRefresh: true
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
    if (!booted) {
      return;
    }

    window.localStorage.setItem(
      clientStateKey,
      JSON.stringify({ profileId, tags, channels })
    );
  }, [booted, profileId, tags, channels]);

  useEffect(() => {
    if (!activeVideo || !videoRef.current) {
      return;
    }

    let disposed = false;
    const video = activeVideo;
    setQuality("auto");
    setQualityOptions([]);

    async function loadPlayer() {
      const dashjs = await import("dashjs");

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

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const response = await fetch(
        `/api/channels/search?q=${encodeURIComponent(channelDraft)}&profileId=${encodeURIComponent(profileId)}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      setChannelResults(data.channels || []);
    }, 300);

    return () => {
      controller.abort();
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

  async function createProfile() {
    if (!profileName.trim()) {
      return;
    }

    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: profileName })
    });
    const data = await response.json();
    setProfiles(data.profiles || []);
    setProfileId(data.profileId || "");
    setProfileName("");
    setTags(starterTags);
    setChannels([]);
    setFeed(null);
    setManageProfiles(false);
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
  }

  async function buildFeed(event?: FormEvent) {
    event?.preventDefault();
    await requestFeed({ forceRefresh: true });
  }

  async function requestFeed(input: {
    nextProfileId?: string;
    nextTags?: string[];
    nextChannels?: string[];
    forceRefresh?: boolean;
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
          forceRefresh: input.forceRefresh === true
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not build this feed.");
      }

      setFeed(data);
      setActiveVideo((current) => current || data.videos[0] || null);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <button type="button" className="brand-button" onClick={() => buildFeed()}>
          Gretel
        </button>
        <div className="profile-menu">
          <button type="button" className="profile-button" onClick={() => setShowProfileMenu(!showProfileMenu)}>
            {activeProfile?.name || "Profile"}
          </button>
          {showProfileMenu && (
            <div className="profile-popover">
              {profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  onClick={() => {
                    setProfileId(profile.id);
                    setFeed(null);
                    setActiveVideo(null);
                    setShowProfileMenu(false);
                  }}
                >
                  {profile.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setManageProfiles(true);
                  setShowProfileMenu(false);
                }}
              >
                Manage profiles
              </button>
            </div>
          )}
        </div>
      </header>

      {feed && (
        <section className={activeVideo ? "watch-layout open" : "watch-layout"}>
          {activeVideo && (
            <div className="watch-player">
              <video ref={videoRef} controls playsInline poster={thumbnailFor(activeVideo)} />
              <div className="watch-meta">
                <h1>{activeVideo.title}</h1>
                <div className="channel-line">
                  <span>{activeVideo.author}</span>
                  <button
                    type="button"
                    className="subscribe-button"
                    onClick={() =>
                      subscriptions.has(normalize(activeVideo.author))
                        ? removeChannel(activeVideo.author)
                        : addChannel(activeVideo.author)
                    }
                  >
                    {subscriptions.has(normalize(activeVideo.author)) ? "Unsubscribe" : "Subscribe"}
                  </button>
                  <span>{formatPublished(activeVideo)}</span>
                </div>
                <div className="player-settings">
                  <label>
                    Quality
                    <select value={quality} onChange={(event) => setQuality(event.target.value)}>
                      <option value="auto">Auto</option>
                      {qualityOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          )}
          <div className="side-list">
            {sideVideos.map((video) => (
              <button type="button" className="side-video" key={video.id} onClick={() => setActiveVideo(video)}>
                <img src={thumbnailFor(video)} loading="lazy" alt="" />
                <span>{video.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {feed && (
        <section className="video-grid" aria-live="polite">
          {feed.videos.map((video) => (
            <article className="video-card" key={video.id}>
              <button type="button" className="thumbnail-button" onClick={() => setActiveVideo(video)}>
                <img src={thumbnailFor(video)} loading="lazy" alt="" />
              </button>
              <div className="video-meta">
                <h2>{video.title}</h2>
                <div className="channel-line">
                  <span>{video.author}</span>
                  <button
                    type="button"
                    className="subscribe-button"
                    onClick={() =>
                      subscriptions.has(normalize(video.author))
                        ? removeChannel(video.author)
                        : addChannel(video.author)
                    }
                  >
                    {subscriptions.has(normalize(video.author)) ? "Unsubscribe" : "Subscribe"}
                  </button>
                  <span>{formatPublished(video)}</span>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {(needsProfile || manageProfiles || !feed) && (
        <div className="modal-backdrop">
          <section className="profile-modal">
            <div className="modal-head">
              <h1>{manageProfiles ? "Manage profiles" : "Create a profile"}</h1>
              {feed && (
                <button type="button" className="icon-button" onClick={() => setManageProfiles(false)}>
                  Close
                </button>
              )}
            </div>

            {manageProfiles && (
              <div className="profile-list">
                {profiles.map((profile) => (
                  <div className="profile-row" key={profile.id}>
                    <span>{profile.name}</span>
                    <button type="button" className="danger-button" onClick={() => deleteProfile(profile.id)}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={buildFeed} className="setup-form">
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Profile name"
              />
              <button type="button" className="secondary-button" onClick={createProfile}>
                Add profile
              </button>

              <TagEditor
                label="Tags"
                values={tags}
                draft={tagDraft}
                setDraft={setTagDraft}
                addValue={addTag}
                removeValue={(value) => setTags(tags.filter((tag) => tag !== value))}
                placeholder="Add a topic"
              />

              <TagEditor
                label="Subscriptions"
                values={channels}
                draft={channelDraft}
                setDraft={setChannelDraft}
                addValue={addChannel}
                removeValue={removeChannel}
                placeholder="Search channel"
              />

              {channelResults.length > 0 && (
                <div className="channel-results">
                  {channelResults.map((channel) => (
                    <button type="button" key={channel.id} onClick={() => addChannel(channel.name)}>
                      {channel.thumbnailUrl && <img src={channel.thumbnailUrl} alt="" />}
                      <span>{channel.name}</span>
                    </button>
                  ))}
                </div>
              )}

              <button type="submit" disabled={loading}>
                {loading ? "Building feed..." : "Build feed"}
              </button>
              {loading && <div className="progress-bar" />}
              {error && <p className="error">{error}</p>}
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function TagEditor(props: {
  label: string;
  values: string[];
  draft: string;
  setDraft: (value: string) => void;
  addValue: (value: string) => void;
  removeValue: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="tag-editor">
      <span>{props.label}</span>
      <div className="tag-input">
        {props.values.map((value) => (
          <button type="button" key={value} onClick={() => props.removeValue(value)}>
            {value}
          </button>
        ))}
        <input
          value={props.draft}
          onChange={(event) => props.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              props.addValue(props.draft);
            }
          }}
          onBlur={() => props.addValue(props.draft)}
          placeholder={props.placeholder}
        />
      </div>
    </label>
  );
}

function thumbnailFor(video: FeedVideo) {
  return video.thumbnailCacheUrl || video.thumbnailUrl || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
}

function formatPublished(video: FeedVideo) {
  if (video.publishedText) {
    return video.duration ? `${video.publishedText} · ${video.duration}` : video.publishedText;
  }

  if (video.publishedAt) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(video.publishedAt);
  }

  return video.duration || "";
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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
