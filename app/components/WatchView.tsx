import { FormEvent, type RefObject, useEffect, useState } from "react";
import {
  Bookmark,
  Heart,
  MessageCircle
} from "lucide-react";

import type { FeedVideo } from "../types";
import { formatPublished, normalize, thumbnailFor } from "./video-utils";

type WatchViewProps = {
  activeVideo: FeedVideo;
  sideVideos: FeedVideo[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  likedVideoIds: Set<string>;
  videoRef: RefObject<HTMLIFrameElement | null>;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
};

export function WatchView(props: WatchViewProps) {
  const [commentDraft, setCommentDraft] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const subscribed = props.subscriptions.has(normalize(props.activeVideo.author));
  const saved = props.savedVideoIds.has(props.activeVideo.id);
  const liked = props.likedVideoIds.has(props.activeVideo.id);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(commentKey(props.activeVideo.id));
      setComments(raw ? JSON.parse(raw).filter((value: unknown) => typeof value === "string") : []);
    } catch {
      setComments([]);
    }

    setCommentDraft("");
  }, [props.activeVideo.id]);

  const embedUrl = `https://www.youtube-nocookie.com/embed/${props.activeVideo.id}?autoplay=1&rel=0`;

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

function commentKey(videoId: string) {
  return `gretel.comments.${videoId}`;
}
