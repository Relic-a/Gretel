import { useRef } from "react";
import { BellOff, EyeOff, LoaderCircle, MoreVertical, ThumbsDown } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { FeedVideo } from "../types";
import { usePopoverDismissal } from "./use-popover-dismissal";

export type CardFeedbackAction = "notInterested" | "hideVideo" | "muteChannel";

type VideoActionsProps = {
  video: FeedVideo;
  saved?: boolean;
  liked?: boolean;
  queued?: boolean;
  className?: string;
  pendingAction?: CardFeedbackAction | null;
  onSaveVideo?: (video: FeedVideo) => void;
  onLikeVideo?: (video: FeedVideo) => void;
  onFeedback?: (action: CardFeedbackAction, video: FeedVideo) => void;
  onEnqueueVideo?: (video: FeedVideo) => void;
};

const feedbackLabels: Record<CardFeedbackAction, string> = {
  notInterested: "Not interested",
  hideVideo: "Hide this video",
  muteChannel: "Mute channel"
};

export function VideoActions(props: VideoActionsProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const classes = ["video-actions", props.className].filter(Boolean).join(" ");
  const busy = props.pendingAction != null;

  function closeMenu() {
    const details = detailsRef.current as HTMLDetailsElement | null;
    if (details?.open) {
      details.open = false;
    }
  }

  usePopoverDismissal(detailsRef, closeMenu);

  function handleFeedback(action: CardFeedbackAction) {
    if (busy) {
      return;
    }

    if (action === "muteChannel" && !window.confirm(`Don't recommend videos from ${props.video.author || "this channel"}?`)) {
      return;
    }

    props.onFeedback?.(action, props.video);
    closeMenu();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeMenu();
      (event.currentTarget as HTMLElement).querySelector("summary") instanceof HTMLElement &&
        ((event.currentTarget as HTMLElement).querySelector("summary") as HTMLElement).focus();
    }
  }

  return (
    <>
      <details
        className={classes}
        ref={detailsRef}
        onKeyDown={handleKeyDown}
        onToggle={(event) => {
        void event;
        }}
      >
      <summary aria-label={`Video actions for ${props.video.title}`}>
        <MoreVertical aria-hidden="true" size={18} />
      </summary>
      <div className="actions-popover" role="menu" aria-label={`Actions for ${props.video.title}`}>
        {props.onFeedback && (
          <>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              aria-busy={props.pendingAction === "notInterested"}
              aria-label={`${feedbackLabels.notInterested}: show fewer videos like ${props.video.title}`}
              title="Show fewer videos like this"
              onClick={() => handleFeedback("notInterested")}
            >
              {props.pendingAction === "notInterested" ? (
                <LoaderCircle aria-hidden="true" size={16} className="spinner" />
              ) : (
                <ThumbsDown aria-hidden="true" size={16} />
              )}
              <span>{feedbackLabels.notInterested}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              aria-busy={props.pendingAction === "hideVideo"}
              aria-label={`${feedbackLabels.hideVideo}: remove ${props.video.title} from feeds now`}
              title="Removes this video from feeds now"
              onClick={() => handleFeedback("hideVideo")}
            >
              {props.pendingAction === "hideVideo" ? (
                <LoaderCircle aria-hidden="true" size={16} className="spinner" />
              ) : (
                <EyeOff aria-hidden="true" size={16} />
              )}
              <span>Hide from feed</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              aria-busy={props.pendingAction === "muteChannel"}
              aria-label={`Don't recommend channel ${props.video.author}`}
              title={`Don't recommend videos from ${props.video.author}`}
              className="actions-danger"
              onClick={() => handleFeedback("muteChannel")}
            >
              {props.pendingAction === "muteChannel" ? (
                <LoaderCircle aria-hidden="true" size={16} className="spinner" />
              ) : (
                <BellOff aria-hidden="true" size={16} />
              )}
              <span>Don't recommend channel</span>
            </button>
          </>
        )}
      </div>
    </details>
    </>
  );
}
