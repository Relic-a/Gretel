import { useCallback, useEffect, useRef } from "react";

import type { FeedVideo } from "../types";
import { normalize } from "./video-utils";
import { VideoCard } from "./VideoCard";

type FeedViewProps = {
  title: string;
  subtitle: string;
  videos: FeedVideo[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  loading: boolean;
  canAskForMore: boolean;
  onLoadMore: () => void;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onVideoImpression?: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
};

export function FeedView(props: FeedViewProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRequestedRef = useRef(false);
  const impressionHandlerRef = useRef(props.onVideoImpression);

  impressionHandlerRef.current = props.onVideoImpression;

  useEffect(() => {
    if (!props.loading) {
      loadMoreRequestedRef.current = false;
    }
  }, [props.loading, props.videos.length]);

  const loadMore = useCallback(() => {
    if (!props.canAskForMore || props.loading || loadMoreRequestedRef.current) {
      return;
    }

    loadMoreRequestedRef.current = true;
    props.onLoadMore();
  }, [props.canAskForMore, props.loading, props.onLoadMore]);

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

        loadMore();
      },
      { rootMargin: "520px 0px" }
    );

    observer.observe(loader);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !props.onVideoImpression) return;

    const videosById = new Map(props.videos.map((video) => [video.id, video]));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        const video = videosById.get(element.dataset.videoId || "");
        if (video && element.dataset.impressionReported !== "true") {
          element.dataset.impressionReported = "true";
          impressionHandlerRef.current?.(video);
          observer.unobserve(element);
        }
      }
    }, { threshold: 0.5 });

    grid.querySelectorAll<HTMLElement>("[data-video-id]").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [props.videos, Boolean(props.onVideoImpression)]);

  return (
    <section className="feed-view" aria-live="polite">
      <div className="feed-heading">
        {props.title && (
          <div>
            <h1>{props.title} {props.title && <span aria-hidden="true">✦</span>}</h1>
            <p>{props.subtitle}</p>
          </div>
        )}
      </div>

      <div ref={gridRef} className="video-grid">
        {props.videos.map((video) => {
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
          Array.from({ length: props.videos.length === 0 ? 12 : 4 }).map((_, index) => (
            <VideoCardSkeleton key={`feed-skeleton-${index}`} />
          ))}
      </div>

      <div ref={loaderRef} className="feed-loader">
        <span className="loader-copy">
          {props.loading ? "Loading more videos..." : ""}
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
