import { Bookmark, Heart, ListPlus, ListVideo, MoreVertical } from "lucide-react";

import type { FeedVideo } from "../types";

type VideoActionsProps = {
  video: FeedVideo;
  saved: boolean;
  liked: boolean;
  queued?: boolean;
  className?: string;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onEnqueueVideo?: (video: FeedVideo) => void;
};

export function VideoActions(props: VideoActionsProps) {
  const classes = ["video-actions", props.className].filter(Boolean).join(" ");

  return (
    <details className={classes}>
      <summary aria-label="Video actions">
        <MoreVertical aria-hidden="true" size={18} />
      </summary>
      <div className="actions-popover">
        <button type="button" onClick={() => props.onLikeVideo(props.video)}>
          <Heart aria-hidden="true" size={16} fill={props.liked ? "currentColor" : "none"} />
          {props.liked ? "Liked" : "Like"}
        </button>
        <button type="button" onClick={() => props.onSaveVideo(props.video)}>
          <Bookmark aria-hidden="true" size={16} fill={props.saved ? "currentColor" : "none"} />
          {props.saved ? "Saved" : "Save"}
        </button>
        {props.onEnqueueVideo && (
          <button type="button" onClick={() => props.onEnqueueVideo?.(props.video)}>
            {props.queued ? (
              <ListVideo aria-hidden="true" size={16} />
            ) : (
              <ListPlus aria-hidden="true" size={16} />
            )}
            {props.queued ? "Queued" : "Queue"}
          </button>
        )}
      </div>
    </details>
  );
}
