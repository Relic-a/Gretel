import React, { useEffect, useRef } from "react";

import type { FeedVideo } from "../types";
import { VideoActions } from "./VideoActions";
import { formatPublished, handleThumbnailError, thumbnailFor } from "./video-utils";

type VideoCardProps = {
  video: FeedVideo;
  saved: boolean;
  liked: boolean;
  showSubscribe: boolean;
  subscribed?: boolean;
  compact?: boolean;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onLikeVideo: (video: FeedVideo) => void;
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

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || reportedRef.current === videoRef.current.id) {
          return;
        }

        reportedRef.current = videoRef.current.id;
        props.onImpression?.(videoRef.current);
      },
      { threshold: 0 }
    );

    observer.observe(card);
    return () => observer.disconnect();
  }, [props.video.id, props.onImpression]);

  return (
    <article ref={cardRef} className={props.compact ? "video-card compact" : "video-card"}>
      <div className="thumbnail-wrap">
        <button type="button" className="thumbnail-button" onClick={() => props.onSelectVideo(props.video)}>
          <img
            src={thumbnailFor(props.video)}
            loading="lazy"
            alt=""
            onError={(e) => handleThumbnailError(e, props.video.id)}
          />
          {props.video.duration && <span className="duration-pill">{props.video.duration}</span>}
        </button>
        <VideoActions
          video={props.video}
          saved={props.saved}
          liked={props.liked}
          onSaveVideo={props.onSaveVideo}
          onLikeVideo={props.onLikeVideo}
        />
      </div>
      <div className="video-meta">
        <h2>{props.video.title}</h2>
        <div className="channel-line">
          {props.video.channelAvatarUrl ? (
            <img className="avatar" src={props.video.channelAvatarUrl} alt="" loading="lazy" />
          ) : (
            <span className="avatar">{props.video.author.slice(0, 1).toUpperCase()}</span>
          )}
          <span>{props.video.author}</span>
          <span className="verified-dot" aria-label="Verified channel" />
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
        <div className="published-line">{formatPublished(props.video)}</div>
      </div>
    </article>
  );
});
