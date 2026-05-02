"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { DEFAULT_GRETEL_CONFIG } from "../lib/feed/config-defaults";

type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  query: string;
  sourceNodeId?: FeedNodeId;
  sourceNodeLabel?: string;
  channelKey?: string;
};

type FeedNodeId =
  | "tagSearch"
  | "channelVideos"
  | "relatedVideos"
  | "watchedVideos";

type FeedNodeWeights = Record<FeedNodeId, number>;

type FeedNodeSummary = {
  id: FeedNodeId;
  label: string;
  weight: number;
  effectiveWeight: number;
  inputVideos: number;
  outputVideos: number;
};

type Profile = {
  id: string;
  name: string;
};

type FeedResponse = {
  tags: string[];
  channels: string[];
  channelSort: "latest" | "popular";
  profile: Profile;
  weights: FeedNodeWeights;
  queries: string[];
  nodes: FeedNodeSummary[];
  cache?: {
    videos: number;
    targetVideos: number;
    refreshedAt: number;
    subscriptionRefreshedAt: number;
    refreshHours: number;
    subscriptionRefreshMinutes: number;
    status: "miss" | "stale" | "hit";
    forced: boolean;
  };
  videos: FeedVideo[];
};

type SavedClientState = {
  profileId?: string;
  tags?: string;
  channels?: string;
  channelSort?: "latest" | "popular";
  weights?: Partial<FeedNodeWeights>;
  feed?: FeedResponse | null;
};

type PublicGretelConfig = {
  feed: {
    maxNodeWeight: number;
    defaultNodeWeights: FeedNodeWeights;
  };
  learning: {
    watchSaveThreshold: number;
  };
  client: {
    watchProgressPollMs: number;
  };
};

const defaultPublicConfig: PublicGretelConfig = {
  feed: {
    maxNodeWeight: DEFAULT_GRETEL_CONFIG.feed.maxNodeWeight,
    defaultNodeWeights: DEFAULT_GRETEL_CONFIG.feed.defaultNodeWeights
  },
  learning: {
    watchSaveThreshold: DEFAULT_GRETEL_CONFIG.learning.watchSaveThreshold
  },
  client: {
    watchProgressPollMs: DEFAULT_GRETEL_CONFIG.client.watchProgressPollMs
  }
};

const starterTags = "AI engineering, TypeScript, product design";
const starterWeights = DEFAULT_GRETEL_CONFIG.feed.defaultNodeWeights;

const nodeControls: Array<{ id: FeedNodeId; label: string }> = [
  { id: "tagSearch", label: "Tag search" },
  { id: "channelVideos", label: "Subscriptions" },
  { id: "relatedVideos", label: "Related videos" },
  { id: "watchedVideos", label: "Watched neighbors" }
];

const clientStateKey = "gretel.clientState.v1";

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [tags, setTags] = useState(starterTags);
  const [channels, setChannels] = useState("");
  const [channelSort, setChannelSort] = useState<"latest" | "popular">("latest");
  const [weights, setWeights] = useState<FeedNodeWeights>(starterWeights);
  const [config, setConfig] = useState<PublicGretelConfig>(defaultPublicConfig);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clientStateLoaded, setClientStateLoaded] = useState(false);
  const subscriptions = useMemo(() => parseSubscriptionList(channels), [channels]);
  const subscribedKeys = useMemo(
    () => new Set(subscriptions.map((subscription) => normalizeSubscription(subscription))),
    [subscriptions]
  );

  function updateWeight(id: FeedNodeId, value: string) {
    setWeights((current) => ({
      ...current,
      [id]: Number(value)
    }));
  }

  function addSubscription(channel: string) {
    const cleaned = channel.replace(/\s+/g, " ").trim();

    if (!cleaned || subscribedKeys.has(normalizeSubscription(cleaned))) {
      return;
    }

    setChannels([...subscriptions, cleaned].join(", "));
  }

  async function createFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestFeed(false, false);
  }

  async function refreshFeed() {
    await requestFeed(false, true);
  }

  async function fetchNewVideos() {
    await requestFeed(true, false);
  }

  async function requestFeed(forceRefresh: boolean, cacheOnly: boolean) {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags,
          channels,
          channelSort,
          weights,
          profileId,
          forceRefresh,
          cacheOnly
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not create feed.");
      }

      setFeed(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create feed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadProfiles(nextProfileId?: string) {
    const response = await fetch("/api/profiles");
    const data = await response.json();
    const nextProfiles = data.profiles || [];
    const selectedProfile =
      nextProfiles.find((profile: Profile) => profile.id === nextProfileId) || nextProfiles[0];

    setProfiles(nextProfiles);
    setProfileId(selectedProfile?.id || "");
    return selectedProfile?.id || "";
  }

  async function createProfile() {
    setError("");
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: profileName })
    });
    const data = await response.json();
    setProfileName("");
    setProfiles(data.profiles || []);
    setProfileId(data.profileId || "");
    setFeed(null);
  }

  async function resetProfile() {
    if (!profileId) {
      return;
    }

    setError("");
    await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", profileId })
    });
    await loadProfiles(profileId);
    setFeed(null);
  }

  async function deleteProfile() {
    if (!profileId) {
      return;
    }

    setError("");
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", profileId })
    });
    const data = await response.json();
    setProfiles(data.profiles || []);
    setProfileId(data.profileId || "");
    setFeed(null);
  }

  useEffect(() => {
    let disposed = false;

    async function loadSavedState() {
      const loadedConfig = await loadPublicConfig();
      const savedState = readSavedClientState();
      setConfig(loadedConfig);

      if (savedState) {
        setProfileId(savedState.profileId || "");
        setTags(savedState.tags || starterTags);
        setChannels(savedState.channels || "");
        setChannelSort(savedState.channelSort || "latest");
        setWeights({ ...loadedConfig.feed.defaultNodeWeights, ...savedState.weights });
        setFeed(savedState.feed || null);
      } else {
        setWeights(loadedConfig.feed.defaultNodeWeights);
      }

      try {
        const selectedProfileId = await loadProfiles(savedState?.profileId);

        if (!disposed && savedState?.feed && savedState.feed.profile.id !== selectedProfileId) {
          setFeed(null);
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "Could not load profiles.");
        }
      } finally {
        if (!disposed) {
          setClientStateLoaded(true);
        }
      }
    }

    loadSavedState();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!clientStateLoaded) {
      return;
    }

    const state: SavedClientState = {
      profileId,
      tags,
      channels,
      channelSort,
      weights,
      feed
    };

    try {
      window.localStorage.setItem(clientStateKey, JSON.stringify(state));
    } catch {
      setError("Could not save this browser state locally.");
    }
  }, [clientStateLoaded, profileId, tags, channels, channelSort, weights, feed]);

  useEffect(() => {
    if (!feed || !profileId) {
      return;
    }

    let disposed = false;
    const players: Array<{
      video: FeedVideo;
      player: {
        getCurrentTime: () => number;
        getDuration: () => number;
        destroy: () => void;
      };
    }> = [];
    const reported = new Set<string>();

    loadYoutubeApi().then((YT) => {
      if (disposed) {
        return;
      }

      for (const video of feed.videos) {
        const element = document.getElementById(`youtube-${video.id}`);

        if (!element) {
          continue;
        }

        const player = new YT.Player(element, {
          events: {
            onReady: () => {
              players.push({ video, player });
            }
          }
        });
      }
    });

    const interval = window.setInterval(() => {
      for (const entry of players) {
        const { video, player } = entry;
        const durationSeconds = player.getDuration();

        if (!video || reported.has(video.id) || durationSeconds <= 0) {
          continue;
        }

        const watchedSeconds = player.getCurrentTime();

        if (watchedSeconds / durationSeconds <= config.learning.watchSaveThreshold) {
          continue;
        }

        reported.add(video.id);
        fetch("/api/watch-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId,
            video,
            watchedSeconds,
            durationSeconds
          })
        }).catch(() => {});
      }
    }, config.client.watchProgressPollMs);

    return () => {
      disposed = true;
      window.clearInterval(interval);

      for (const player of players) {
        player.player.destroy();
      }
    };
  }, [feed, profileId, config]);

  return (
    <main className="shell">
      <section className="composer">
        <div>
          <p className="eyebrow">Gretel MVP</p>
          <h1>Tell the algorithm what you want to watch.</h1>
          <p className="intro">
            Gretel runs each input through weighted nodes, sends seed videos
            into related-video discovery, and mixes every line into one feed.
          </p>
        </div>

        <form onSubmit={createFeed} className="feed-form">
          <fieldset className="profile-settings">
            <legend>Profiles</legend>
            <label htmlFor="profile">Active profile</label>
            <select
              id="profile"
              value={profileId}
              onChange={(event) => {
                setProfileId(event.target.value);
                setFeed(null);
              }}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <div className="profile-actions">
              <input
                aria-label="New profile name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="New profile"
              />
              <button type="button" className="secondary-button" onClick={createProfile}>
                Create
              </button>
              <button type="button" className="secondary-button" onClick={resetProfile}>
                Reset
              </button>
              <button type="button" className="danger-button" onClick={deleteProfile}>
                Delete
              </button>
            </div>
          </fieldset>

          <label htmlFor="tags">Tags</label>
          <input
            id="tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            minLength={2}
            placeholder="AI engineering, TypeScript, product design"
          />

          <label htmlFor="subscriptions">Subscriptions</label>
          <input
            id="subscriptions"
            value={channels}
            onChange={(event) => setChannels(event.target.value)}
            placeholder="Fireship, ThePrimeTime, @veritasium"
          />
          <p className="field-note">
            Add subscriptions manually, or subscribe from a recommended channel below.
          </p>

          <label htmlFor="channel-sort">Subscription sort</label>
          <select
            id="channel-sort"
            value={channelSort}
            onChange={(event) => setChannelSort(event.target.value as "latest" | "popular")}
          >
            <option value="latest">Latest</option>
            <option value="popular">Popular</option>
          </select>

          <fieldset className="network-settings">
            <legend>Network weights</legend>
            {nodeControls.map((node) => (
              <label className="weight-control" key={node.id}>
                <span>{node.label}</span>
                <input
                  type="range"
                  min="0"
                  max={config.feed.maxNodeWeight}
                  step="1"
                  value={weights[node.id]}
                  onChange={(event) => updateWeight(node.id, event.target.value)}
                />
                <strong>{weights[node.id]}</strong>
              </label>
            ))}
          </fieldset>

          <button type="submit" disabled={loading}>
            {loading ? "Curating..." : "Build feed"}
          </button>
        </form>

        {error && <p className="error">{error}</p>}
      </section>

      {feed && (
        <section className="results" aria-live="polite">
          <div className="results-head">
            <div>
              <p className="eyebrow">Weighted network</p>
              <h2>{feed.videos.length} videos</h2>
              {feed.cache && (
                <p className="cache-status">
                  {feed.cache.videos}/{feed.cache.targetVideos} cached · refreshes every {feed.cache.refreshHours}h ·
                  subscriptions every {feed.cache.subscriptionRefreshMinutes}m
                </p>
              )}
            </div>
            <div className="feed-actions">
              <button type="button" className="secondary-button" onClick={refreshFeed} disabled={loading}>
                Refresh feed
              </button>
              <button type="button" className="secondary-button" onClick={fetchNewVideos} disabled={loading}>
                Fetch new videos
              </button>
            </div>
            <div className="tag-list" aria-label="Tags used">
              {feed.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
              {feed.channels.map((channel) => (
                <span className="subscription-chip" key={channel}>
                  Subscribed: {channel}
                </span>
              ))}
            </div>
            <div className="query-list">
              {feed.queries.map((query) => (
                <span key={query}>{query}</span>
              ))}
            </div>
          </div>

          <div className="node-grid" aria-label="Feed node results">
            {feed.nodes.map((node) => (
              <article className="node-card" key={node.id}>
                <p>{node.label}</p>
                <strong>{node.effectiveWeight}</strong>
                <span>
                  Base {node.weight} · {node.outputVideos} of {node.inputVideos} used
                </span>
              </article>
            ))}
          </div>

          <div className="video-grid">
            {feed.videos.map((video) => {
              const subscribed = subscribedKeys.has(normalizeSubscription(video.author));

              return (
                <article className={subscribed ? "video-card subscribed" : "video-card"} key={video.id}>
                  <iframe
                    id={`youtube-${video.id}`}
                    src={`https://www.youtube.com/embed/${video.id}?enablejsapi=1${
                      typeof window === "undefined"
                        ? ""
                        : `&origin=${encodeURIComponent(window.location.origin)}`
                    }`}
                    title={video.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                  <div className="video-meta">
                    <div className="video-source-row">
                      <p className="source-query">{video.query}</p>
                      {subscribed && <span className="subscribed-mark">Subscribed</span>}
                    </div>
                    <h3>{video.title}</h3>
                    <div className="channel-row">
                      <p>
                        {video.author}
                        {video.duration ? ` · ${video.duration}` : ""}
                      </p>
                      <button
                        type="button"
                        className="subscribe-button"
                        onClick={() => addSubscription(video.author)}
                        disabled={subscribed}
                      >
                        {subscribed ? "Subscribed" : "Subscribe"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          events: {
            onReady: () => void;
          };
        }
      ) => {
        getCurrentTime: () => number;
        getDuration: () => number;
        destroy: () => void;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<NonNullable<Window["YT"]>> | null = null;

function loadYoutubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => {
        if (window.YT) {
          resolve(window.YT);
        }
      };

      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
    });
  }

  return youtubeApiPromise;
}

function parseSubscriptionList(value: string) {
  return value
    .split(",")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeSubscription(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/config");

    if (!response.ok) {
      return defaultPublicConfig;
    }

    return { ...defaultPublicConfig, ...(await response.json()) } as PublicGretelConfig;
  } catch {
    return defaultPublicConfig;
  }
}

function readSavedClientState() {
  try {
    const rawState = window.localStorage.getItem(clientStateKey);

    if (!rawState) {
      return null;
    }

    const state = JSON.parse(rawState) as SavedClientState;
    return {
      profileId: typeof state.profileId === "string" ? state.profileId : undefined,
      tags: typeof state.tags === "string" ? state.tags : undefined,
      channels: typeof state.channels === "string" ? state.channels : undefined,
      channelSort:
        state.channelSort === "latest" || state.channelSort === "popular"
          ? state.channelSort
          : undefined,
      weights: state.weights && typeof state.weights === "object" ? state.weights : undefined,
      feed: state.feed || null
    } satisfies SavedClientState;
  } catch {
    return null;
  }
}
