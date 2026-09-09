"use client";

import { useRef, useState } from "react";
import { GripVertical, ListVideo, Loader2, MoreHorizontal, Play, RotateCcw, Trash2, X } from "lucide-react";
import type { FeedVideo } from "../types";
import type { QueueSnapshot } from "./use-playback-queue";
import { handleThumbnailError, thumbnailFor } from "./video-utils";
import { usePopoverDismissal } from "./use-popover-dismissal";

type QueuePanelProps = { snapshot: QueueSnapshot | null; loading: boolean; mutating: boolean; error: string; activeVideoId: string; onSelectVideo: (video: FeedVideo) => void; onMove: (videoId: string, toIndex: number) => void; onRemove: (videoId: string) => void; onClear: () => void; onToggleAutoplay: (enabled: boolean) => void; onRetry: () => void; onClose?: () => void };

export function QueuePanel(props: QueuePanelProps) {
  const items = props.snapshot?.items ?? [];
  const autoplay = props.snapshot?.autoplayEnabled !== false;
  const currentId = props.snapshot?.currentVideoId ?? null;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const optionsRef = useRef<HTMLDetailsElement | null>(null);
  function closeOptions() { if (optionsRef.current?.open) optionsRef.current.open = false; }
  usePopoverDismissal(optionsRef, closeOptions);
  function reorderTo(videoId: string, targetId: string) { const from = items.findIndex((video) => video.id === videoId); const to = items.findIndex((video) => video.id === targetId); if (from !== -1 && to !== -1 && from !== to) props.onMove(videoId, to); setDraggedId(null); }
  return <section className="queue-panel queue-drawer" aria-label="Playback queue">
    <div className="queue-head"><div className="queue-title"><h2>Queue</h2><span className="queue-count">{items.length} {items.length === 1 ? "video" : "videos"}</span></div><div className="queue-head-controls">
      <label className="toggle-control queue-autoplay" title="Play the next queued video automatically"><input type="checkbox" checked={autoplay} disabled={!props.snapshot || props.mutating} onChange={(event) => props.onToggleAutoplay(event.target.checked)} aria-label="Autoplay next queued video" /><span className="toggle-track" aria-hidden="true"><span className="toggle-knob" /></span><span className="queue-autoplay-label">Autoplay</span></label>
      {items.length > 0 && <details ref={optionsRef} className="queue-more"><summary aria-label="Queue options"><MoreHorizontal size={18} /></summary><div className="queue-options"><button type="button" disabled={props.mutating} onClick={() => { props.onClear(); closeOptions(); }}><Trash2 size={15} /> Clear queue</button></div></details>}
      {props.onClose && <button type="button" className="queue-close" aria-label="Close queue" onClick={props.onClose}><X size={18} /></button>}
    </div></div>
    {props.loading && !props.snapshot && <div className="queue-state" aria-live="polite"><Loader2 size={18} className="spinner" /> Loading your queue…</div>}
    {props.error && <div className="queue-state queue-error" role="alert"><span>{props.error}</span><button type="button" onClick={props.onRetry}><RotateCcw size={14} /> Retry</button></div>}
    {props.snapshot && items.length === 0 && !props.error && <div className="queue-state queue-empty"><ListVideo size={22} /><div><strong>Nothing queued yet</strong><p>Add videos from Home and they’ll appear here.</p></div></div>}
    {items.length > 0 && <ol className="queue-list">{items.map((video, index) => { const isCurrent = video.id === currentId || video.id === props.activeVideoId; return <li key={video.id} className={`queue-item ${isCurrent ? "is-current" : ""}`} aria-current={isCurrent ? "true" : undefined} draggable={!props.mutating} onDragStart={() => setDraggedId(video.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedId && reorderTo(draggedId, video.id)}>
      <button type="button" className="queue-drag-handle" aria-label={`Reorder ${video.title}; use Arrow keys`} title="Drag to reorder" onKeyDown={(event) => { if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); props.onMove(video.id, index - 1); } if (event.key === "ArrowDown" && index < items.length - 1) { event.preventDefault(); props.onMove(video.id, index + 1); } }}><GripVertical size={17} /></button>
      <button type="button" className="queue-thumb" onClick={() => props.onSelectVideo(video)} aria-label={`Play ${video.title}`}><img src={thumbnailFor(video)} loading="lazy" alt="" onError={(event) => handleThumbnailError(event, video.id)} />{video.duration && <span className="duration-pill">{video.duration}</span>}</button>
      <button type="button" className="queue-copy" onClick={() => props.onSelectVideo(video)}><strong title={video.title}>{isCurrent && <Play size={12} fill="currentColor" aria-hidden="true" />} {video.title}</strong><small>{video.author}</small></button>
      <button type="button" className="queue-icon-button danger queue-remove" disabled={props.mutating} onClick={() => props.onRemove(video.id)} aria-label={`Remove ${video.title} from the queue`} title="Remove"><X size={15} /></button>
    </li>; })}</ol>}
    {!autoplay && items.length > 0 && <p className="queue-note" role="status">Autoplay is off.</p>}
  </section>;
}
