import { useEffect, useMemo, useRef, useState } from "react";

import type { FeedVideo } from "../types";
import { normalize } from "./video-utils";
import { VideoCard } from "./VideoCard";

type FeedViewProps = {
  title: string;
  subtitle: string;
  videos: FeedVideo[];
  tags: string[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  loading: boolean;
  canAskForMore: boolean;
  onLoadMore: () => void;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
};

const batchSize = 12;

export function FeedView(props: FeedViewProps) {
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const feedKeyRef = useRef("");
  const [activeTag, setActiveTag] = useState<string>("All");
  const visibleVideos = useMemo(
    () => props.videos.filter(v => activeTag === "All" || v.originTag === activeTag).slice(0, visibleCount),
    [props.videos, activeTag, visibleCount]
  );
  const currentPage = Math.max(1, Math.ceil(visibleVideos.length / batchSize));
  const pageCount = Math.max(1, Math.ceil(props.videos.filter(v => activeTag === "All" || v.originTag === activeTag).length / batchSize));

  useEffect(() => {
    const feedKey = props.videos[0]?.id || "";

    if (feedKeyRef.current !== feedKey) {
      feedKeyRef.current = feedKey;
      setVisibleCount(batchSize);
      return;
    }

    setVisibleCount((count) => Math.min(Math.max(count, batchSize), props.videos.length));
  }, [props.videos]);

  useEffect(() => {
    const loader = loaderRef.current;

    if (!loader) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) {
          return;
        }

        if (visibleCount < props.videos.length) {
          setVisibleCount((count) => Math.min(count + batchSize, props.videos.length));
        } else if (props.canAskForMore && !props.loading) {
          props.onLoadMore();
        }
      },
      { rootMargin: "520px 0px" }
    );

    observer.observe(loader);
    return () => observer.disconnect();
  }, [props, visibleCount]);

  return (
    <section className="feed-view" aria-live="polite">
      <div className="feed-heading">
        {props.title && (
          <div>
            <h1>{props.title} {props.title && <span aria-hidden="true">✦</span>}</h1>
            <p>{props.subtitle}</p>
          </div>
        )}
        <div className="feed-filters" aria-label="Feed filters">
          <button type="button" className={`chip ${activeTag === "All" ? "active" : ""}`} onClick={() => { setActiveTag("All"); setVisibleCount(batchSize); }}>All</button>
          {props.tags.map(tag => (
            <button key={tag} type="button" className={`chip ${activeTag === tag ? "active" : ""}`} onClick={() => { setActiveTag(tag); setVisibleCount(batchSize); }}>{tag}</button>
          ))}
          <button type="button" className="filter-button" aria-label="Open filters">
            <span aria-hidden="true">≡</span> Filters
          </button>
        </div>
      </div>

      <div className="video-grid">
        {visibleVideos.map((video) => {
          const subscribed = props.subscriptions.has(normalize(video.author));

          return (
            <VideoCard
              key={video.id}
              video={video}
              saved={props.savedVideoIds.has(video.id)}
              liked={props.likedVideoIds.has(video.id)}
              showSubscribe={false}
              subscribed={subscribed}
              onSelectVideo={props.onSelectVideo}
              onSaveVideo={props.onSaveVideo}
              onLikeVideo={props.onLikeVideo}
              onAddChannel={props.onAddChannel}
              onRemoveChannel={props.onRemoveChannel}
            />
          );
        })}
        {props.loading &&
          Array.from({ length: visibleVideos.length === 0 ? batchSize : 4 }).map((_, index) => (
            <VideoCardSkeleton key={`feed-skeleton-${index}`} />
          ))}
      </div>

      <div ref={loaderRef} className="feed-loader">
        <span className="loader-copy">
          {props.loading ? "Loading more videos..." : visibleVideos.length < props.videos.length ? "Loading..." : ""}
        </span>
      </div>
    </section>
  );
}

function VideoCardSkeleton() {
  return (
    <article className="video-card skeleton-card" aria-hidden="true">
      <div className="skeleton skeleton-thumb" />
      <div className="video-meta">
        <div className="skeleton skeleton-line wide" />
        <div className="skeleton skeleton-line medium" />
        <div className="skeleton skeleton-channel">
          <span className="skeleton skeleton-avatar" />
          <span className="skeleton skeleton-line short" />
        </div>
        <div className="skeleton skeleton-button" />
        <div className="skeleton skeleton-line tiny" />
      </div>
    </article>
  );
}
