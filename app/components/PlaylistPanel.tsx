"use client";

import { Bookmark, ListPlus, Loader2, Play, RotateCcw, X } from "lucide-react";

import type { FeedVideo, PlaylistDetails } from "../types";
import { handleThumbnailError, thumbnailFor } from "./video-utils";

type PlaylistPanelProps = {
  playlist: FeedVideo;
  details: PlaylistDetails | null;
  nextVideoId: string | null;
  loading: boolean;
  error: string;
  activeVideoId: string;
  saved: boolean;
  queued: boolean;
  onSelectVideo: (video: FeedVideo) => void;
  onPlayAll: (video: FeedVideo) => void;
  onToggleSave: () => void;
  onEnqueue: () => void;
  onRetry: () => void;
  onClose: () => void;
};

export function PlaylistPanel(props: PlaylistPanelProps) {
  const videos = props.details?.videos ?? [];
  const autoplayIds = props.details?.autoplayVideoIds ?? [];
  const total = videos.length || props.playlist.playlistVideoCount || 0;
  const firstVideo = videos.find((video) => video.id === autoplayIds[0]) || videos[0] || null;

  return (
    <aside className="playlist-panel" aria-label={`Playlist ${props.playlist.title}`}>
      <div className="playlist-head">
        <div className="playlist-head-copy">
          <span className="playlist-eyebrow">
            Playlist{total > 0 ? ` · ${total} ${total === 1 ? "video" : "videos"}` : ""}
          </span>
          <h2 title={props.playlist.title}>{props.playlist.title}</h2>
          <span className="playlist-author">{props.playlist.author}</span>
        </div>
        <button
          type="button"
          className="queue-close"
          aria-label="Close playlist"
          onClick={props.onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="playlist-actions">
        <button
          type="button"
          className="playlist-play-all"
          disabled={!firstVideo}
          onClick={() => firstVideo && props.onPlayAll(firstVideo)}
        >
          <Play aria-hidden="true" size={15} fill="currentColor" />
          Play all
        </button>
        <button
          type="button"
          className={props.saved ? "playlist-action saved" : "playlist-action"}
          aria-pressed={props.saved}
          onClick={props.onToggleSave}
        >
          <Bookmark aria-hidden="true" size={15} fill={props.saved ? "currentColor" : "none"} />
          {props.saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          className={props.queued ? "playlist-action queued" : "playlist-action"}
          aria-pressed={props.queued}
          title="Add every video in this playlist to the queue"
          onClick={props.onEnqueue}
        >
          <ListPlus aria-hidden="true" size={15} />
          {props.queued ? "Queued" : "Queue all"}
        </button>
      </div>

      {props.loading && !props.details && (
        <div className="playlist-state" aria-live="polite">
          <Loader2 size={18} className="spinner" aria-hidden="true" />
          <span>Loading playlist…</span>
        </div>
      )}

      {props.error && (
        <div className="playlist-state playlist-error" role="alert">
          <span>{props.error}</span>
          <button type="button" onClick={props.onRetry}>
            <RotateCcw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {props.details && videos.length === 0 && !props.error && (
        <div className="playlist-state playlist-empty">
          <strong>This playlist is empty</strong>
          <p>No videos are available to play right now.</p>
        </div>
      )}

      {videos.length > 0 && (
        <ol className="playlist-list">
          {videos.map((video, index) => {
            const isCurrent = video.id === props.activeVideoId;
            const isNext = !isCurrent && video.id === props.nextVideoId;
            return (
              <li
                key={video.id}
                className={`playlist-item${isCurrent ? " is-current" : ""}${isNext ? " is-next" : ""}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                <span className="playlist-position" aria-hidden="true">
                  {isCurrent ? <Play size={12} fill="currentColor" /> : index + 1}
                </span>
                <button
                  type="button"
                  className="playlist-thumb"
                  onClick={() => props.onSelectVideo(video)}
                  aria-label={`Play ${index + 1}. ${video.title}`}
                >
                  <img
                    src={thumbnailFor(video)}
                    loading="lazy"
                    alt=""
                    onError={(event) => handleThumbnailError(event, video.id)}
                  />
                  {video.duration && <span className="duration-pill">{video.duration}</span>}
                </button>
                <button
                  type="button"
                  className="playlist-copy"
                  onClick={() => props.onSelectVideo(video)}
                >
                  <strong title={video.title}>{video.title}</strong>
                  <small title={video.author}>{video.author}</small>
                  {isNext && <em className="playlist-next-tag">Up next</em>}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {videos.length > 0 && (
        <p className="playlist-note" role="status">
          {autoplayIds.length > 1
            ? `Autoplays through ${autoplayIds.length} videos in order.`
            : "Autoplay continues with the next video in this playlist."}
        </p>
      )}
    </aside>
  );
}
