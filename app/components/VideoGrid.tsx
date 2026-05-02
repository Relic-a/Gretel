import type { FeedVideo } from "../types";
import { VideoActions } from "./VideoActions";
import { formatPublished, normalize, thumbnailFor } from "./video-utils";

type VideoGridProps = {
  videos: FeedVideo[];
  subscriptions: Set<string>;
  savedVideoIds: Set<string>;
  onSelectVideo: (video: FeedVideo) => void;
  onSaveVideo: (video: FeedVideo) => void;
  onAddChannel: (channel: string) => void;
  onRemoveChannel: (channel: string) => void;
};

export function VideoGrid(props: VideoGridProps) {
  return (
    <section className="video-grid" aria-live="polite">
      {props.videos.map((video) => {
        const subscribed = props.subscriptions.has(normalize(video.author));
        const saved = props.savedVideoIds.has(video.id);

        return (
          <article className="video-card" key={video.id}>
            <div className="thumbnail-wrap">
              <button type="button" className="thumbnail-button" onClick={() => props.onSelectVideo(video)}>
                <img src={thumbnailFor(video)} loading="lazy" alt="" />
              </button>
              <VideoActions video={video} saved={saved} onSaveVideo={props.onSaveVideo} />
            </div>
            <div className="video-meta">
              <h2>{video.title}</h2>
              <div className="channel-line">
                <span>{video.author}</span>
                <button
                  type="button"
                  className="subscribe-button"
                  onClick={() => (subscribed ? props.onRemoveChannel(video.author) : props.onAddChannel(video.author))}
                >
                  {subscribed ? "Unsubscribe" : "Subscribe"}
                </button>
                <span>{formatPublished(video)}</span>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
