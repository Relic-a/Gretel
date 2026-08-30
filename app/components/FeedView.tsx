import { useCallback, useEffect, useRef } from "react";

import type { FeedVideo } from "../types";
import { normalize } from "./video-utils";
import { VideoCard } from "./VideoCard";
import { FeedBuildProgress } from "./FeedBuildProgress";

type FeedViewProps = {
  title: string;
  subtitle: string;
  videos: FeedVideo[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  loading: boolean;
  isBuilding?: boolean;
  canAskForMore: boolean;
  profileName?: string;
  tags?: string[];
  channels?: string[];
  loadingLabel?: string;
  onLoadMore: () => void;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onVideoImpression?: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
};

export function FeedView(props: FeedViewProps) {
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRequestedRef = useRef(false);

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
    let scrollEndTimer = 0;

    function markActiveScroll() {
      document.documentElement.classList.add("is-scrolling");
      window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("is-scrolling");
      }, 140);
    }

    window.addEventListener("scroll", markActiveScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", markActiveScroll);
      window.clearTimeout(scrollEndTimer);
      document.documentElement.classList.remove("is-scrolling");
    };
  }, []);

  const isInitialBuild = Boolean(props.isBuilding) && props.videos.length === 0 && props.loading;

  return (
    <section className="feed-view" aria-live="polite">
      {isInitialBuild && (
        <FeedBuildProgress
          profileName={props.profileName}
          tags={props.tags}
          channels={props.channels}
          loadingLabel={props.loadingLabel}
        />
      )}

      <div className="feed-heading">
        {props.title && (
          <div>
            <h1>{props.title} {props.title && <span aria-hidden="true">✦</span>}</h1>
            <p>{props.subtitle}</p>
          </div>
        )}
      </div>

      <div className="video-grid">
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
              onImpression={props.onVideoImpression}
              onAddChannel={props.onAddChannel}
              onRemoveChannel={props.onRemoveChannel}
            />
          );
        })}
        {props.loading &&
          Array.from({ length: props.videos.length === 0 ? 8 : 4 }).map((_, index) => (
            <VideoCardSkeleton key={`feed-skeleton-${index}`} />
          ))}
      </div>

      <div ref={loaderRef} className="feed-loader">
        <span className="loader-copy">
          {props.loading && props.videos.length > 0 ? "Loading more videos..." : ""}
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
