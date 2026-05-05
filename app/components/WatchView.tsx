import { FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Heart,
  Maximize,
  MessageCircle,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX
} from "lucide-react";

import type { FeedVideo } from "../types";
import { formatPublished, normalize, thumbnailFor } from "./video-utils";

type WatchViewProps = {
  activeVideo: FeedVideo;
  sideVideos: FeedVideo[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  quality: string;
  qualityOptions: Array<{ value: string; label: string }>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
  onQualityChange: (quality: string) => void;
};

export function WatchView(props: WatchViewProps) {
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const subscribed = props.subscriptions.has(normalize(props.activeVideo.author));
  const saved = props.savedVideoIds.has(props.activeVideo.id);
  const liked = props.likedVideoIds.has(props.activeVideo.id);

  useEffect(() => {
    const video = props.videoRef.current;

    if (!video) {
      return;
    }

    const element = video;

    function sync() {
      setPlaying(!element.paused);
      setMuted(element.muted);
      setCurrentTime(element.currentTime || 0);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    }

    sync();
    element.addEventListener("play", sync);
    element.addEventListener("pause", sync);
    element.addEventListener("timeupdate", sync);
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("volumechange", sync);

    return () => {
      element.removeEventListener("play", sync);
      element.removeEventListener("pause", sync);
      element.removeEventListener("timeupdate", sync);
      element.removeEventListener("loadedmetadata", sync);
      element.removeEventListener("volumechange", sync);
    };
  }, [props.activeVideo.id, props.videoRef]);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === playerShellRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(commentKey(props.activeVideo.id));
      setComments(raw ? JSON.parse(raw).filter((value: unknown) => typeof value === "string") : []);
    } catch {
      setComments([]);
    }

    setCommentDraft("");
  }, [props.activeVideo.id]);

  function togglePlay() {
    const video = props.videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function seek(value: string) {
    const video = props.videoRef.current;

    if (video) {
      video.currentTime = Number(value);
    }
  }

  function toggleMute() {
    const video = props.videoRef.current;

    if (video) {
      video.muted = !video.muted;
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await playerShellRef.current?.requestFullscreen();
  }

  function addComment(event: FormEvent) {
    event.preventDefault();
    const nextComment = commentDraft.replace(/\s+/g, " ").trim();

    if (!nextComment) {
      return;
    }

    const nextComments = [nextComment, ...comments];
    setComments(nextComments);
    setCommentDraft("");

    try {
      window.localStorage.setItem(commentKey(props.activeVideo.id), JSON.stringify(nextComments));
    } catch {
      // Comments remain visible for this session if storage is unavailable.
    }
  }

  return (
    <section className="watch-layout open">
      <div className="watch-player">
        <div className="player-shell" ref={playerShellRef}>
          <video ref={props.videoRef} playsInline poster={thumbnailFor(props.activeVideo)} onClick={togglePlay} />
          <div className="player-controls">
            <button type="button" className="control-button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause aria-hidden="true" size={20} /> : <Play aria-hidden="true" size={20} />}
            </button>
            <span className="time-code">{formatTime(currentTime)}</span>
            <input
              type="range"
              className="seek-control"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || currentTime)}
              onChange={(event) => seek(event.target.value)}
              aria-label="Seek"
            />
            <span className="time-code">{formatTime(duration)}</span>
            <button type="button" className="control-button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX aria-hidden="true" size={20} /> : <Volume2 aria-hidden="true" size={20} />}
            </button>
            <label className="quality-control">
              <span>Quality</span>
              <select value={props.quality} onChange={(event) => props.onQualityChange(event.target.value)}>
                <option value="auto">Auto</option>
                {props.qualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="control-button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {fullscreen ? <Minimize aria-hidden="true" size={20} /> : <Maximize aria-hidden="true" size={20} />}
            </button>
          </div>
        </div>
        <div className="watch-meta">
          <h1>{props.activeVideo.title}</h1>
          <div className="watch-actions-row">
            <div className="watch-channel">
              <span className="avatar large">{props.activeVideo.author.slice(0, 1).toUpperCase()}</span>
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
          <div className="comments-section">
            <h2><MessageCircle aria-hidden="true" size={19} /> Comments</h2>
            <form className="comment-form" onSubmit={addComment}>
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add a comment"
                rows={3}
              />
              <button type="submit">Comment</button>
            </form>
            <div className="comment-list">
              {comments.length === 0 && <p>No comments yet.</p>}
              {comments.map((comment, index) => (
                <article className="comment" key={`${comment}-${index}`}>
                  <span className="avatar">Y</span>
                  <p>{comment}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="side-list">
        <div className="side-head">
          <h2>Up next</h2>
          <label className="toggle"><span>Autoplay</span><input type="checkbox" defaultChecked /></label>
        </div>
        {props.sideVideos.map((video) => (
          <button type="button" className="side-video" key={video.id} onClick={() => props.onSelectVideo(video)}>
            <span className="side-thumb">
              <img src={thumbnailFor(video)} loading="lazy" alt="" />
              {video.duration && <span className="duration-pill">{video.duration}</span>}
            </span>
            <span className="side-copy">
              <strong>{video.title}</strong>
              <small>{video.author}</small>
              <small>{formatPublished(video)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");

  return `${minutes}:${remainder}`;
}

function commentKey(videoId: string) {
  return `gretel.comments.${videoId}`;
}
