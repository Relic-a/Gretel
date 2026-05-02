import type { RefObject } from "react";

import type { FeedVideo } from "../types";
import { VideoActions } from "./VideoActions";
import { formatPublished, normalize, thumbnailFor } from "./video-utils";

type WatchViewProps = {
  activeVideo: FeedVideo;
  sideVideos: FeedVideo[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  quality: string;
  qualityOptions: Array<{ value: string; label: string }>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
  onQualityChange: (quality: string) => void;
};

export function WatchView(props: WatchViewProps) {
  const subscribed = props.subscriptions.has(normalize(props.activeVideo.author));
  const saved = props.savedVideoIds.has(props.activeVideo.id);

  return (
    <section className="watch-layout open">
      <div className="watch-player">
        <video ref={props.videoRef} controls playsInline poster={thumbnailFor(props.activeVideo)} />
        <div className="watch-meta">
          <div className="watch-title-row">
            <h1>{props.activeVideo.title}</h1>
            <VideoActions
              video={props.activeVideo}
              saved={saved}
              className="inline-actions"
              onSaveVideo={props.onSaveVideo}
            />
          </div>
          <div className="channel-line">
            <span>{props.activeVideo.author}</span>
            <button
              type="button"
              className="subscribe-button"
              onClick={() =>
                subscribed ? props.onRemoveChannel(props.activeVideo.author) : props.onAddChannel(props.activeVideo.author)
              }
            >
              {subscribed ? "Unsubscribe" : "Subscribe"}
            </button>
            <span>{formatPublished(props.activeVideo)}</span>
          </div>
          <div className="player-settings">
            <label>
              Quality
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
        </div>
      </div>
      <div className="side-list">
        {props.sideVideos.map((video) => (
          <button type="button" className="side-video" key={video.id} onClick={() => props.onSelectVideo(video)}>
            <img src={thumbnailFor(video)} loading="lazy" alt="" />
            <span>{video.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
