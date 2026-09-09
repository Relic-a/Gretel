import React, { useEffect, useRef } from "react";
import { Bookmark, ListPlus, ListVideo } from "lucide-react";

import type { FeedVideo } from "../types";
import type { CardFeedbackAction } from "./VideoActions";
import { observeCardIntersection } from "./shared-intersection-observer";
import { VideoActions } from "./VideoActions";
import { formatPublished, handleThumbnailError, thumbnailFor } from "./video-utils";

type VideoCardProps = {
  video: FeedVideo;
  saved: boolean;
  liked: boolean;
  queued?: boolean;
  showSubscribe: boolean;
  subscribed?: boolean;
  compact?: boolean;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
  onFeedback?: (action: CardFeedbackAction, video: FeedVideo) => void;
  feedbackPendingAction?: CardFeedbackAction | null;
  onEnqueueVideo?: (video: FeedVideo) => void;
  onImpression?: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
};

export const VideoCard = React.memo(function VideoCard(props: VideoCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const reportedRef = useRef("");
  const videoRef = useRef(props.video);
  videoRef.current = props.video;

  useEffect(() => {
    reportedRef.current = "";
  }, [props.video.id]);

  useEffect(() => {
    const card = cardRef.current;

    if (!card || !props.onImpression) {
      return;
    }

    return observeCardIntersection(card, (entry) => {
      if (!entry.isIntersecting || reportedRef.current === videoRef.current.id) {
        return;
      }

      reportedRef.current = videoRef.current.id;
      props.onImpression?.(videoRef.current);
    });
  }, [props.video.id, props.onImpression]);

  return (
    <article ref={cardRef} className={props.compact ? "video-card compact" : "video-card"}>
      <div className="thumbnail-wrap">
        {/* One-tap actions: Save and Queue live on the thumbnail so the common
            cases never require opening the ⋮ menu. */}
        <div className="card-quick-actions">
          {props.onEnqueueVideo && (
            <button
              type="button"
              className={props.queued ? "quick-action queued" : "quick-action"}
              aria-label={props.queued ? `${props.video.title} is queued` : `Queue ${props.video.title}`}
              title={props.queued ? "In your queue" : "Add to queue"}
              onClick={() => props.onEnqueueVideo?.(props.video)}
            >
              {props.queued ? <ListVideo aria-hidden="true" size={16} /> : <ListPlus aria-hidden="true" size={16} />}
            </button>
          )}
          <button
            type="button"
            className={props.saved ? "quick-action saved" : "quick-action"}
            aria-label={props.saved ? `Remove ${props.video.title} from saved` : `Save ${props.video.title}`}
            title={props.saved ? "Saved" : "Save"}
            onClick={() => props.onSaveVideo(props.video)}
          >
            <Bookmark aria-hidden="true" size={16} fill={props.saved ? "currentColor" : "none"} />
          </button>
        </div>
        <button type="button" className="thumbnail-button" onClick={() => props.onSelectVideo(props.video)}>
          <img
            src={thumbnailFor(props.video)}
            loading="lazy"
            alt=""
            onError={(e) => handleThumbnailError(e, props.video.id)}
          />
          {props.video.duration && <span className="duration-pill">{props.video.duration}</span>}
        </button>
      </div>
      <div className="video-meta">
        <div className="video-title-row">
          <h2 title={props.video.title}>{props.video.title}</h2>
          <VideoActions
            video={props.video}
            saved={props.saved}
            liked={props.liked}
            queued={props.queued}
            pendingAction={props.feedbackPendingAction}
            onSaveVideo={props.onSaveVideo}
            onLikeVideo={props.onLikeVideo}
            onFeedback={props.onFeedback}
            onEnqueueVideo={props.onEnqueueVideo}
          />
        </div>
        <div className="channel-line">
          {props.video.channelAvatarUrl ? (
            <img className="avatar" src={props.video.channelAvatarUrl} alt="" loading="lazy" />
          ) : (
            <span className="avatar">{props.video.author.slice(0, 1).toUpperCase()}</span>
          )}
          <span className="channel-name" title={props.video.author}>
            {props.video.author}
          </span>
        </div>
        {props.showSubscribe && (
          <button
            type="button"
            className={props.subscribed ? "subscribe-button ghost" : "subscribe-button"}
            onClick={() =>
              props.subscribed ? props.onRemoveChannel(props.video.author) : props.onAddChannel(props.video.author)
            }
          >
            {props.subscribed ? "Unsubscribe" : "Subscribe"}
          </button>
        )}
        <div className="published-line" title={formatPublished(props.video)}>
          {formatPublished(props.video)}
        </div>
      </div>
    </article>
  );
});
