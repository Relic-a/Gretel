import type { FeedVideo } from "../types";

type VideoActionsProps = {
  video: FeedVideo;
  saved: boolean;
  liked: boolean;
  className?: string;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
};

export function VideoActions(props: VideoActionsProps) {
  const classes = ["video-actions", props.className].filter(Boolean).join(" ");

  return (
    <details className={classes}>
      <summary aria-label="Video actions">⋮</summary>
      <div className="actions-popover">
        <button type="button" onClick={() => props.onLikeVideo(props.video)}>
          {props.liked ? "Liked" : "Like"}
        </button>
        <button type="button" onClick={() => props.onSaveVideo(props.video)}>
          {props.saved ? "Saved" : "Save"}
        </button>
      </div>
    </details>
  );
}
