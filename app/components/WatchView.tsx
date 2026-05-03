import type { RefObject } from "react";

import type { FeedVideo } from "../types";
import { VideoActions } from "./VideoActions";
import { formatPublished, normalize, thumbnailFor } from "./video-utils";
import { VideoCard } from "./VideoCard";

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
  const subscribed = props.subscriptions.has(normalize(props.activeVideo.author));
  const saved = props.savedVideoIds.has(props.activeVideo.id);
  const liked = props.likedVideoIds.has(props.activeVideo.id);
  const channelVideos = props.sideVideos.filter(
    (video) => normalize(video.author) === normalize(props.activeVideo.author)
  );
  const moreFromChannel = (channelVideos.length > 0 ? channelVideos : props.sideVideos).slice(0, 4);

  return (
    <section className="watch-layout open">
      <div className="watch-player">
        <video ref={props.videoRef} controls playsInline poster={thumbnailFor(props.activeVideo)} />
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
            <button type="button" className={liked ? "action-button active" : "action-button"} onClick={() => props.onLikeVideo(props.activeVideo)}>
              {liked ? "Liked" : "Like"}
            </button>
            <button type="button" className={saved ? "action-button active" : "action-button"} onClick={() => props.onSaveVideo(props.activeVideo)}>
              {saved ? "Saved" : "Save"}
            </button>
            <VideoActions
              video={props.activeVideo}
              saved={saved}
              liked={liked}
              className="inline-actions"
              onSaveVideo={props.onSaveVideo}
              onLikeVideo={props.onLikeVideo}
            />
          </div>
          <div className="player-settings">
            <label>
              <select value={props.quality} onChange={(event) => props.onQualityChange(event.target.value)}>
                <option value="auto">Auto</option>
                {props.qualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="more-section">
            <h2>More from {props.activeVideo.author}</h2>
            <div className="more-grid">
              {moreFromChannel.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  saved={props.savedVideoIds.has(video.id)}
                  liked={props.likedVideoIds.has(video.id)}
                  showSubscribe={false}
                  compact
                  onSelectVideo={props.onSelectVideo}
                  onSaveVideo={props.onSaveVideo}
                  onLikeVideo={props.onLikeVideo}
                  onAddChannel={props.onAddChannel}
                  onRemoveChannel={props.onRemoveChannel}
                />
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
