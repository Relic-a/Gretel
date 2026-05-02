import type { FeedVideo } from "../types";

type VideoActionsProps = {
  video: FeedVideo;
  saved: boolean;
  className?: string;
  onSaveVideo: (video: FeedVideo) => void;
};

export function VideoActions(props: VideoActionsProps) {
  const classes = ["video-actions", props.className].filter(Boolean).join(" ");

  return (
    <details className={classes}>
      <summary aria-label="Video actions">...</summary>
      <button type="button" onClick={() => props.onSaveVideo(props.video)}>
        {props.saved ? "Saved" : "Save video"}
      </button>
    </details>
  );
}
