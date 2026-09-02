import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  CircleAlert,
  ExternalLink,
  Heart,
  MessageCircle,
  ChevronDown,
  Loader2,
  Pin,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { FeedVideo } from "../types";
import { formatPublished, handleThumbnailError, normalize, thumbnailFor, authedHeaders } from "./video-utils";
import {
  describeYouTubePlayerError,
  type YouTubePlayerErrorInfo,
  youtubeWatchUrl
} from "./youtube-player-error";

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        config: {
          videoId?: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YTPlayerInstance = {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  destroy: () => void;
  getIframe: () => HTMLIFrameElement;
};

function loadYouTubeIframeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return;
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }

    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };

    if (!document.getElementById("gretel-yt-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "gretel-yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
}

type WatchViewProps = {
  activeVideo: FeedVideo;
  sideVideos: FeedVideo[];
  loadingFeed: boolean;
  canLoadMoreSideVideos: boolean;
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  profileId: string;
  videoRef?: React.RefObject<HTMLIFrameElement | null>;
  onSelectVideo: (video: FeedVideo) => void;
  onLoadMoreSideVideos: () => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
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
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const timePollIntervalRef = useRef<number | null>(null);

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
  const [playerError, setPlayerError] = useState<YouTubePlayerErrorInfo | null>(null);
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

  const visibleSideVideos = props.sideVideos.slice(0, displayLimit);

  useEffect(() => {
    let destroyed = false;

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
    setPlayerError(null);
    fetchInProgress.current = false;
    if (sideLoadDebounceRef.current !== null) {
      window.clearTimeout(sideLoadDebounceRef.current);
      sideLoadDebounceRef.current = null;
    }
    sideLoadRequestedRef.current = false;
    props.onPlaybackStateChange?.(false);

    function stopPolling() {
      if (timePollIntervalRef.current !== null) {
        window.clearInterval(timePollIntervalRef.current);
        timePollIntervalRef.current = null;
      }
    }

    function startPolling(player: YTPlayerInstance) {
      stopPolling();
      timePollIntervalRef.current = window.setInterval(() => {
        try {
          const currentTime = player.getCurrentTime() || 0;
          const duration = player.getDuration() || 0;
          if (currentTime > 0 || duration > 0) {
            props.onTimeUpdate?.(currentTime, duration);
          }
        } catch {}
      }, 500);
    }

    void loadYouTubeIframeApi().then(() => {
      if (destroyed || !playerContainerRef.current || !window.YT?.Player) {
        return;
      }

      try {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        playerRef.current = new window.YT.Player(playerContainerRef.current, {
          videoId: props.activeVideo.id,
          playerVars: {
            autoplay: 1,
            rel: 0,
            enablejsapi: 1,
            origin: origin
          },
          events: {
            onReady: (event) => {
              if (destroyed) return;
              try {
                const duration = event.target.getDuration();
                const currentTime = event.target.getCurrentTime();
                if (currentTime > 0 || duration > 0) {
                  props.onTimeUpdate?.(currentTime, duration);
                }
              } catch {}
            },
            onStateChange: (event) => {
              if (destroyed) return;
              if (event.data === window.YT?.PlayerState.ENDED) {
                stopPolling();
                props.onPlaybackStateChange?.(false);
                try {
                  event.target.stopVideo();
                } catch {}
                return;
              }
              const isPlaying = (event.data === window.YT?.PlayerState.PLAYING);
              props.onPlaybackStateChange?.(isPlaying);

              if (isPlaying && playerRef.current) {
                setPlayerError(null);
                startPolling(playerRef.current);
              } else {
                stopPolling();
                try {
                  const currentTime = playerRef.current?.getCurrentTime() || 0;
                  const duration = playerRef.current?.getDuration() || 0;
                  if (currentTime > 0 || duration > 0) {
                    props.onTimeUpdate?.(currentTime, duration);
                  }
                } catch {}
              }
            },
            onError: (event) => {
              if (destroyed) return;

              const playerFailure = describeYouTubePlayerError(event.data);
              let playerUrl: string | undefined;
              try {
                playerUrl = playerRef.current?.getIframe().src;
              } catch {}
              const details = {
                youtubeErrorCode: playerFailure.code,
                youtubeErrorKind: playerFailure.kind,
                videoId: props.activeVideo.id,
                documentOrigin: window.location.origin,
                userAgent: window.navigator.userAgent,
                platform: window.navigator.platform,
                tauri: isTauri()
              };

              stopPolling();
              props.onPlaybackStateChange?.(false);
              setPlayerError(playerFailure);
              console.error("YouTube iframe player error", details);

              void fetch("/api/client-errors", {
                method: "POST",
                headers: authedHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({
                  source: "youtube.iframe_player",
                  message: `${playerFailure.title} (YouTube error ${playerFailure.code}, ${playerFailure.kind})`,
                  url: playerUrl,
                  details
                }),
                keepalive: true
              }).catch(() => undefined);
            }
          }
        });
      } catch {}
    });

    return () => {
      destroyed = true;
      stopPolling();
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, [props.activeVideo.id]);

  async function openActiveVideoOnYouTube() {
    const url = youtubeWatchUrl(props.activeVideo.id);

    if (isTauri()) {
      try {
        await openUrl(url);
        return;
      } catch (caught) {
        console.error("Could not open YouTube in the default browser", caught);
      }
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

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
          <div
            ref={playerContainerRef}
            style={{ width: "100%", height: "100%", border: 0 }}
          />
          {playerError && (
            <div className="player-fallback" role="alert">
              <CircleAlert aria-hidden="true" size={30} />
              <div className="player-fallback-copy">
                <strong>{playerError.title}</strong>
                <p>{playerError.message}</p>
                <small>Player error {playerError.code}</small>
              </div>
              <button type="button" onClick={() => void openActiveVideoOnYouTube()}>
                Open on YouTube
                <ExternalLink aria-hidden="true" size={16} />
              </button>
            </div>
          )}
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
