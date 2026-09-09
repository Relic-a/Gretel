"use client";

import { ArrowDown, ArrowUp, ListVideo, Loader2, Play, RotateCcw, SkipForward, Trash2, X } from "lucide-react";

import type { FeedVideo } from "../types";
import type { QueueSnapshot } from "./use-playback-queue";
import { formatPublished, handleThumbnailError, thumbnailFor } from "./video-utils";

type QueuePanelProps = {
  snapshot: QueueSnapshot | null;
  loading: boolean;
  mutating: boolean;
  error: string;
  activeVideoId: string;
  onSelectVideo: (video: FeedVideo) => void;
  onPlayNext: () => void;
  onMove: (videoId: string, toIndex: number) => void;
  onRemove: (videoId: string) => void;
  onClear: () => void;
  onToggleAutoplay: (enabled: boolean) => void;
  onRetry: () => void;
};

function padPosition(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function QueuePanel(props: QueuePanelProps) {
  const snapshot = props.snapshot;
  const items = snapshot?.items ?? [];
  const upNext = snapshot?.upNextVideos ?? [];
  const autoplay = snapshot?.autoplayEnabled !== false;
  const currentId = snapshot?.currentVideoId ?? null;
  const busy = props.mutating;

  return (
    <section className="queue-panel" aria-label="Playback queue">
      <div className="queue-head">
        <div className="queue-title">
          <span className="queue-eyebrow">
            <ListVideo aria-hidden="true" size={13} />
            Queue
          </span>
          <h2>
            Up next{" "}
            <span className="queue-count" aria-label={`${upNext.length} videos up next`}>
              {snapshot && !props.loading ? `${upNext.length}` : "—"}
            </span>
          </h2>
        </div>
        <div className="queue-head-controls">
          <label className="toggle-control queue-autoplay" title="Play the next queued video automatically">
            <input
              type="checkbox"
              checked={autoplay}
              disabled={!snapshot || busy}
              onChange={(event) => props.onToggleAutoplay(event.target.checked)}
              aria-label="Autoplay next queued video"
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
            <span className="queue-autoplay-label">Autoplay</span>
          </label>
          <button
            type="button"
            className="queue-next-button"
            disabled={!snapshot || busy || upNext.length === 0}
            onClick={props.onPlayNext}
            title={upNext.length > 0 ? `Play next: ${upNext[0].title}` : "Queue is empty"}
          >
            <SkipForward aria-hidden="true" size={15} />
            Next
          </button>
        </div>
      </div>

      {!autoplay && snapshot && items.length > 0 && (
        <p className="queue-note" role="status">
          Autoplay is off — playback stops when this video ends.
        </p>
      )}

      {props.loading && !snapshot && (
        <div className="queue-state" aria-live="polite">
          <Loader2 aria-hidden="true" size={18} className="spinner" />
          <span>Loading your queue…</span>
        </div>
      )}

      {props.error && (
        <div className="queue-state queue-error" role="alert">
          <span>{props.error}</span>
          <button type="button" className="secondary-button queue-retry" onClick={props.onRetry}>
            <RotateCcw aria-hidden="true" size={14} />
            Retry
          </button>
        </div>
      )}

      {snapshot && !props.loading && items.length === 0 && !props.error && (
        <div className="queue-state queue-empty">
          <ListVideo aria-hidden="true" size={22} />
          <div>
            <strong>Nothing queued yet</strong>
            <p>Queue videos from any card or side video to build tonight’s lineup.</p>
          </div>
        </div>
      )}

      {snapshot && items.length > 0 && (
        <>
          <ol className="queue-list">
            {items.map((video, index) => {
              const isCurrent = video.id === currentId;
              const isActive = video.id === props.activeVideoId;
              const isUpNext = upNext.some((item) => item.id === video.id);
              return (
                <li
                  key={video.id}
                  className={[
                    "queue-item",
                    isCurrent ? "is-current" : "",
                    isActive ? "is-active" : ""
                  ].filter(Boolean).join(" ")}
                  aria-current={isCurrent ? "true" : undefined}
                >
                  <span className="queue-position" aria-hidden="true">
                    {isCurrent ? <Play size={12} fill="currentColor" /> : padPosition(index)}
                  </span>
                  <button
                    type="button"
                    className="queue-thumb"
                    onClick={() => props.onSelectVideo(video)}
                    aria-label={`Play ${video.title}`}
                  >
                    <img
                      src={thumbnailFor(video)}
                      loading="lazy"
                      alt=""
                      onError={(e) => handleThumbnailError(e, video.id)}
                    />
                    {video.duration && <span className="duration-pill">{video.duration}</span>}
                  </button>
                  <span className="queue-copy">
                    <strong title={video.title}>{video.title}</strong>
                    <small>{video.author}</small>
                    <small>{formatPublished(video)}</small>
                    <span className="queue-badges">
                      {isCurrent && <span className="queue-badge current">Now queued</span>}
                      {isUpNext && !isCurrent && <span className="queue-badge next">Up next</span>}
                    </span>
                  </span>
                  <span className="queue-item-controls">
                    <button
                      type="button"
                      className="queue-icon-button"
                      disabled={busy || index === 0}
                      onClick={() => props.onMove(video.id, index - 1)}
                      aria-label={`Move ${video.title} earlier in the queue`}
                      title="Move earlier"
                    >
                      <ArrowUp aria-hidden="true" size={15} />
                    </button>
                    <button
                      type="button"
                      className="queue-icon-button"
                      disabled={busy || index === items.length - 1}
                      onClick={() => props.onMove(video.id, index + 1)}
                      aria-label={`Move ${video.title} later in the queue`}
                      title="Move later"
                    >
                      <ArrowDown aria-hidden="true" size={15} />
                    </button>
                  </span>
                  <button
                    type="button"
                    className="queue-icon-button danger queue-remove"
                    disabled={busy}
                    onClick={() => props.onRemove(video.id)}
                    aria-label={`Remove ${video.title} from the queue`}
                    title="Remove"
                  >
                    <X aria-hidden="true" size={15} />
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="queue-foot">
            <span className="queue-foot-copy" aria-live="polite">
              {busy ? "Updating queue…" : `${items.length} in queue · ${upNext.length} after this one`}
            </span>
            <button
              type="button"
              className="queue-clear"
              disabled={busy}
              onClick={props.onClear}
            >
              <Trash2 aria-hidden="true" size={14} />
              Clear queue
            </button>
          </div>
        </>
      )}
    </section>
  );
}
