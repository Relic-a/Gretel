"use client";

import { FormEvent, useState } from "react";

type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  query: string;
};

type FeedNodeId = "tagSearch" | "channelVideos" | "naturalLanguage" | "relatedVideos";

type FeedNodeWeights = Record<FeedNodeId, number>;

type FeedNodeSummary = {
  id: FeedNodeId;
  label: string;
  weight: number;
  inputVideos: number;
  outputVideos: number;
};

type FeedResponse = {
  prompt?: string;
  tags: string[];
  channels: string[];
  channelSort: "latest" | "popular";
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
  relatedVideos: 3
};

const nodeControls: Array<{ id: FeedNodeId; label: string }> = [
  { id: "tagSearch", label: "Tag search" },
  { id: "channelVideos", label: "Channel videos" },
  { id: "naturalLanguage", label: "Natural language" },
  { id: "relatedVideos", label: "Related videos" }
];

export default function Home() {
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
          weights
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
                <strong>{node.weight}</strong>
                <span>
                  {node.outputVideos} of {node.inputVideos} used
                </span>
              </article>
            ))}
          </div>

          <div className="video-grid">
            {feed.videos.map((video) => (
              <article className="video-card" key={video.id}>
                <iframe
                  src={`https://www.youtube.com/embed/${video.id}`}
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
