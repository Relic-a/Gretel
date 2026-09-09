import { useRef, useState } from "react";
import { BellOff, Bookmark, EyeOff, Heart, ListPlus, ListVideo, LoaderCircle, MoreVertical, ThumbsDown } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { FeedVideo } from "../types";

export type CardFeedbackAction = "notInterested" | "hideVideo" | "muteChannel";

type VideoActionsProps = {
  video: FeedVideo;
  saved: boolean;
  liked: boolean;
  queued?: boolean;
  className?: string;
  pendingAction?: CardFeedbackAction | null;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
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
  const [confirmingMute, setConfirmingMute] = useState(false);
  const classes = ["video-actions", props.className].filter(Boolean).join(" ");
  const busy = props.pendingAction != null;
  const channelName = props.video.author || "this channel";

  function closeMenu() {
    const details = detailsRef.current as HTMLDetailsElement | null;
    if (details?.open) {
      details.open = false;
    }
    setConfirmingMute(false);
  }

  function handleFeedback(action: CardFeedbackAction) {
    if (busy) {
      return;
    }

    if (action === "muteChannel" && !confirmingMute) {
      setConfirmingMute(true);
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
          if (!(event.currentTarget as HTMLDetailsElement).open) {
            setConfirmingMute(false);
          }
        }}
      >
      <summary aria-label={`Video actions for ${props.video.title}`}>
        <MoreVertical aria-hidden="true" size={18} />
      </summary>
      <div className="actions-popover" role="menu" aria-label={`Actions for ${props.video.title}`}>
        <button type="button" role="menuitem" onClick={() => { props.onLikeVideo(props.video); closeMenu(); }}>
          <Heart aria-hidden="true" size={16} fill={props.liked ? "currentColor" : "none"} />
          <span>
            {props.liked ? "Liked" : "Like"}
            <small>{props.liked ? "Removed from your likes" : "More like this"}</small>
          </span>
        </button>
        {props.onEnqueueVideo && (
          <button type="button" role="menuitem" onClick={() => { props.onEnqueueVideo?.(props.video); closeMenu(); }}>
            {props.queued ? (
              <ListVideo aria-hidden="true" size={16} />
            ) : (
              <ListPlus aria-hidden="true" size={16} />
            )}
            <span>
              {props.queued ? "Queued" : "Queue"}
              <small>Watch it after this one</small>
            </span>
          </button>
        )}
        {props.onFeedback && (
          <>
            <div className="actions-separator" role="separator" aria-hidden="true" />
            <p className="actions-label" aria-hidden="true">Tune recommendations</p>
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
              <span>
                {feedbackLabels.notInterested}
                <small>Fewer like this</small>
              </span>
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
              <span>
                {feedbackLabels.hideVideo}
                <small>Removes it now</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              aria-busy={props.pendingAction === "muteChannel"}
              aria-label={
                confirmingMute
                  ? `Confirm mute: hide every video from ${channelName}`
                  : `${feedbackLabels.muteChannel}: hide every video from ${channelName}`
              }
              title={confirmingMute ? `Hides every video from ${channelName}` : `Hide every video from ${channelName}`}
              className={confirmingMute ? "actions-danger-armed" : "actions-danger"}
              onClick={() => handleFeedback("muteChannel")}
            >
              {props.pendingAction === "muteChannel" ? (
                <LoaderCircle aria-hidden="true" size={16} className="spinner" />
              ) : (
                <BellOff aria-hidden="true" size={16} />
              )}
              <span>
                {confirmingMute ? `Mute ${channelName}?` : `Mute ${channelName}`}
                <small>{confirmingMute ? "Hides all their videos · click again" : "Hides all their videos"}</small>
              </span>
            </button>
          </>
        )}
      </div>
    </details>
    </>
  );
}
