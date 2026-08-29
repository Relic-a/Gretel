import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Heart,
  MessageCircle,
  ChevronDown,
  Loader2,
  Pin,
} from "lucide-react";

import type { FeedVideo } from "../types";
import { formatPublished, handleThumbnailError, normalize, thumbnailFor, authedHeaders } from "./video-utils";

type WatchViewProps = {
  activeVideo: FeedVideo;
  sideVideos: FeedVideo[];
  loadingFeed: boolean;
  canLoadMoreSideVideos: boolean;
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  profileId: string;
  videoRef: React.RefObject<HTMLIFrameElement | null>;
  onSelectVideo: (video: FeedVideo) => void;
  onLoadMoreSideVideos: () => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
};

type YtComment = {
  author: string;
  authorAvatarUrl?: string;
  content: string;
  published: string;
  likes: string;
  isPinned: boolean;
  authorIsOwner: boolean;
};

export function WatchView(props: WatchViewProps) {
  const sidePageSize = 12;
  const [description, setDescription] = useState("");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(sidePageSize);
  const [comments, setComments] = useState<YtComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sideSentinelRef = useRef<HTMLDivElement | null>(null);
  const commentsSectionRef = useRef<HTMLDivElement | null>(null);
  const fetchInProgress = useRef(false);
  const sideLoadRequestedRef = useRef(false);
  const displayLimitRef = useRef(sidePageSize);
  const sideLoadDebounceRef = useRef<number | null>(null);

  const subscribed = props.subscriptions.has(normalize(props.activeVideo.author));
  const saved = props.savedVideoIds.has(props.activeVideo.id);
  const liked = props.likedVideoIds.has(props.activeVideo.id);

  const embedUrl = `https://www.youtube-nocookie.com/embed/${props.activeVideo.id}?autoplay=1&rel=0&enablejsapi=1`;
  const visibleSideVideos = props.sideVideos.slice(0, displayLimit);

  useEffect(() => {
    setDescription("");
    setDescriptionExpanded(false);
    setDisplayLimit(sidePageSize);
    setComments([]);
    setLoading(false);
    setLoadingMore(false);
    setError("");
    setHasMore(true);
    setPage(0);
    setCommentsLoaded(false);
    fetchInProgress.current = false;
    if (sideLoadDebounceRef.current !== null) {
      window.clearTimeout(sideLoadDebounceRef.current);
      sideLoadDebounceRef.current = null;
    }
    sideLoadRequestedRef.current = false;
    props.onPlaybackStateChange?.(false);
  }, [props.activeVideo.id]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        if (!event.data) return;
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data && typeof data === "object") {
          if (data.event === "onStateChange") {
            props.onPlaybackStateChange?.(data.info === 1);
          } else if (data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number") {
            props.onPlaybackStateChange?.(data.info.playerState === 1);
          }
        }
      } catch {}
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [props.onPlaybackStateChange]);

  useEffect(() => {
    displayLimitRef.current = displayLimit;
  }, [displayLimit]);

  useEffect(() => {
    setDisplayLimit((current) => (current > props.sideVideos.length ? props.sideVideos.length : current));
  }, [props.sideVideos.length]);

  useEffect(() => {
    if (!props.loadingFeed) {
      sideLoadRequestedRef.current = false;
    }
  }, [props.loadingFeed, props.sideVideos.length]);

  useEffect(() => {
    return () => {
      if (sideLoadDebounceRef.current !== null) {
        window.clearTimeout(sideLoadDebounceRef.current);
      }
    };
  }, []);

  // Lazy-load comments when the user scrolls past the player into the meta area
  useEffect(() => {
    const section = commentsSectionRef.current;
    if (!section || commentsLoaded) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !commentsLoaded && !fetchInProgress.current) {
          fetchInProgress.current = true;
          fetchComments(0);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [commentsLoaded, props.activeVideo.id]);

  // Infinite scroll: load more when the sentinel becomes visible
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !commentsLoaded || !hasMore || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !fetchInProgress.current) {
          fetchInProgress.current = true;
          fetchComments(page + 1);
        }
      },
      { rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [commentsLoaded, hasMore, loadingMore, page, props.activeVideo.id]);

  useEffect(() => {
    const sentinel = sideSentinelRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) {
          return;
        }

        const currentLimit = displayLimitRef.current;

        if (currentLimit >= props.sideVideos.length && !props.canLoadMoreSideVideos) {
          return;
        }

        if (currentLimit < props.sideVideos.length) {
          setDisplayLimit((current) => Math.min(current + sidePageSize, props.sideVideos.length));
        }

        if (
          props.sideVideos.length === currentLimit &&
          props.canLoadMoreSideVideos &&
          !props.loadingFeed &&
          !sideLoadRequestedRef.current
        ) {
          sideLoadRequestedRef.current = true;

          if (sideLoadDebounceRef.current !== null) {
            window.clearTimeout(sideLoadDebounceRef.current);
          }

          sideLoadDebounceRef.current = window.setTimeout(() => {
            sideLoadDebounceRef.current = null;
            props.onLoadMoreSideVideos();
          }, 200);
        }
      },
      { rootMargin: "320px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    props.canLoadMoreSideVideos,
    props.loadingFeed,
    props.onLoadMoreSideVideos,
    props.sideVideos.length
  ]);

  async function fetchComments(nextPage: number) {
    if (nextPage === 0) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError("");

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: authedHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          videoId: props.activeVideo.id,
          profileId: props.profileId,
          page: nextPage,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load comments.");
      }

      if (nextPage === 0) {
        setComments(data.comments || []);
        setDescription(data.description || "");
        setCommentsLoaded(true);
      } else {
        setComments((prev) => [...prev, ...(data.comments || [])]);
        setPage(nextPage);
      }

      setHasMore(data.hasMore === true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load comments.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      fetchInProgress.current = false;
    }
  }

  return (
    <section className="watch-layout open">
      <div className="watch-player">
        <div className="player-shell">
          <iframe
            ref={props.videoRef}
            src={embedUrl}
            width="100%"
            height="100%"
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            style={{ border: 0, display: "block" }}
            title={props.activeVideo.title}
          />
        </div>
        <div className="watch-meta">
          <h1>{props.activeVideo.title}</h1>
          <div className="watch-actions-row">
            <div className="watch-channel">
              {props.activeVideo.channelAvatarUrl ? (
                <img className="avatar large" src={props.activeVideo.channelAvatarUrl} alt="" />
              ) : (
                <span className="avatar large avatar-placeholder" />
              )}
              <div>
                <strong>{props.activeVideo.author}</strong>
                <span>{formatPublished(props.activeVideo)}</span>
              </div>
            </div>
            <button
              type="button"
              className="subscribe-button"
              onClick={() =>
                subscribed ? props.onRemoveChannel(props.activeVideo.author) : props.onAddChannel(props.activeVideo.author)
              }
            >
              {subscribed ? "Unsubscribe" : "Subscribe"}
            </button>
            <button
              type="button"
              className={liked ? "action-button icon-only active" : "action-button icon-only"}
              onClick={() => props.onLikeVideo(props.activeVideo)}
              aria-label={liked ? "Unlike video" : "Like video"}
              title={liked ? "Unlike" : "Like"}
            >
              <Heart aria-hidden="true" size={19} fill={liked ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              className={saved ? "action-button icon-only active" : "action-button icon-only"}
              onClick={() => props.onSaveVideo(props.activeVideo)}
              aria-label={saved ? "Remove from saved videos" : "Save video"}
              title={saved ? "Unsave" : "Save"}
            >
              <Bookmark aria-hidden="true" size={19} fill={saved ? "currentColor" : "none"} />
            </button>
          </div>

          {/* Video description */}
          {description && (
            <div className="watch-description">
              <div className={`description-body ${descriptionExpanded ? "expanded" : "collapsed"}`}>
                {description}
              </div>
              {description.length > 300 && (
                <button
                  type="button"
                  className="description-toggle"
                  onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                >
                  {descriptionExpanded ? "Show less" : "Show more"}
                  <ChevronDown
                    aria-hidden="true"
                    size={16}
                    style={{
                      transform: descriptionExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>
              )}
            </div>
          )}

          {/* Comments section — lazy-loaded via IntersectionObserver */}
          <div className="comments-section" ref={commentsSectionRef}>
            <h2><MessageCircle aria-hidden="true" size={19} /> Comments</h2>

            {loading && (
              <div className="comments-loader">
                <Loader2 aria-hidden="true" size={20} className="spinner" />
                <span>Loading comments…</span>
              </div>
            )}

            {error && <p className="comments-error">{error}</p>}

            {commentsLoaded && comments.length === 0 && !loading && (
              <p className="comments-empty">No comments yet.</p>
            )}

            {comments.length > 0 && (
              <div className="comment-list">
                {comments.map((comment, index) => (
                  <article className="comment" key={`${comment.author}-${comment.published}-${index}`}>
                    {comment.authorAvatarUrl ? (
                      <img className="avatar" src={comment.authorAvatarUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="avatar avatar-placeholder" />
                    )}
                    <div className="comment-body">
                      <div className="comment-head">
                        <strong className="comment-author">
                          {comment.author}
                          {comment.authorIsOwner && (
                            <span className="owner-badge" title="Channel owner">&#x2713;</span>
                          )}
                        </strong>
                        <span className="comment-time">{comment.published}</span>
                      </div>
                      <p>{comment.content}</p>
                      {comment.likes !== "0" && (
                        <span className="comment-likes">&#x2764; {comment.likes}</span>
                      )}
                      {comment.isPinned && (
                        <span className="comment-pinned">
                          <Pin aria-hidden="true" size={12} /> Pinned
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Sentinel for infinite scroll */}
            {commentsLoaded && hasMore && (
              <div ref={sentinelRef} className="comments-sentinel">
                {loadingMore && (
                  <div className="comments-loader">
                    <Loader2 aria-hidden="true" size={20} className="spinner" />
                    <span>Loading more comments…</span>
                  </div>
                )}
              </div>
            )}

            {commentsLoaded && !hasMore && comments.length > 0 && (
              <p className="comments-end">No more comments.</p>
            )}
          </div>
        </div>
      </div>
      <div className="side-list">
        <div className="side-head">
          <h2>Up next</h2>
          <label className="toggle"><span>Autoplay</span><input type="checkbox" defaultChecked /></label>
        </div>
        {visibleSideVideos.map((video) => (
          <button type="button" className="side-video" key={video.id} onClick={() => props.onSelectVideo(video)}>
            <span className="side-thumb">
              <img src={thumbnailFor(video)} loading="lazy" alt="" onError={(e) => handleThumbnailError(e, video.id)} />
              {video.duration && <span className="duration-pill">{video.duration}</span>}
            </span>
            <span className="side-copy">
              <strong>{video.title}</strong>
              <small>{video.author}</small>
              <small>{formatPublished(video)}</small>
            </span>
          </button>
        ))}
        <div ref={sideSentinelRef} className="side-sentinel">
          {props.loadingFeed && (
            <div className="comments-loader">
              <Loader2 aria-hidden="true" size={18} className="spinner" />
              <span>Loading more videos…</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
