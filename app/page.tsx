"use client";

import { FormEvent, useEffect, useState } from "react";

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
  | "naturalLanguage"
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
  prompt?: string;
  tags: string[];
  channels: string[];
  channelSort: "latest" | "popular";
  profile: Profile;
  weights: FeedNodeWeights;
  queries: string[];
  nodes: FeedNodeSummary[];
  videos: FeedVideo[];
};

const starterTags = "AI engineering, TypeScript, product design";
const starterWeights: FeedNodeWeights = {
  tagSearch: 2,
  channelVideos: 2,
  naturalLanguage: 1,
  relatedVideos: 3,
  watchedVideos: 2
};

const nodeControls: Array<{ id: FeedNodeId; label: string }> = [
  { id: "tagSearch", label: "Tag search" },
  { id: "channelVideos", label: "Channel videos" },
  { id: "naturalLanguage", label: "Natural language" },
  { id: "relatedVideos", label: "Related videos" },
  { id: "watchedVideos", label: "Watched neighbors" }
];

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [tags, setTags] = useState(starterTags);
  const [channels, setChannels] = useState("");
  const [channelSort, setChannelSort] = useState<"latest" | "popular">("latest");
  const [prompt, setPrompt] = useState("");
  const [weights, setWeights] = useState<FeedNodeWeights>(starterWeights);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateWeight(id: FeedNodeId, value: string) {
    setWeights((current) => ({
      ...current,
      [id]: Number(value)
    }));
  }

  async function createFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          prompt,
          weights,
          profileId
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
    loadProfiles().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Could not load profiles.");
    });
  }, []);

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

        if (watchedSeconds / durationSeconds <= 0.5) {
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
    }, 2000);

    return () => {
      disposed = true;
      window.clearInterval(interval);

      for (const player of players) {
        player.player.destroy();
      }
    };
  }, [feed, profileId]);

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

          <label htmlFor="channels">Channels</label>
          <input
            id="channels"
            value={channels}
            onChange={(event) => setChannels(event.target.value)}
            placeholder="Fireship, ThePrimeTime, @veritasium"
          />

          <label htmlFor="channel-sort">Channel sort</label>
          <select
            id="channel-sort"
            value={channelSort}
            onChange={(event) => setChannelSort(event.target.value as "latest" | "popular")}
          >
            <option value="latest">Latest</option>
            <option value="popular">Popular</option>
          </select>

          <label htmlFor="prompt">Natural-language tuning</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minLength={8}
            placeholder="Describe topics, tone, formats, creators, and what to avoid."
            aria-describedby="prompt-status"
          />
          <p id="prompt-status" className="field-note">
            Optional. This works as its own search line and as lightweight tuning,
            like avoiding shorts.
          </p>

          <fieldset className="network-settings">
            <legend>Network weights</legend>
            {nodeControls.map((node) => (
              <label className="weight-control" key={node.id}>
                <span>{node.label}</span>
                <input
                  type="range"
                  min="0"
                  max="5"
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
            </div>
            <div className="tag-list" aria-label="Tags used">
              {feed.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
              {feed.channels.map((channel) => (
                <span key={channel}>{channel}</span>
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
            {feed.videos.map((video) => (
              <article className="video-card" key={video.id}>
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
                  <p className="source-query">{video.query}</p>
                  <h3>{video.title}</h3>
                  <p>
                    {video.author}
                    {video.duration ? ` · ${video.duration}` : ""}
                  </p>
                </div>
              </article>
            ))}
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
