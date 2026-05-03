export type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  thumbnailUrl?: string;
  thumbnailCacheUrl?: string;
  publishedText?: string;
  publishedAt?: number;
  viewCount?: number;
  channelKey?: string;
  parent_video_id?: string;
  parent_title?: string;
  parent_author?: string;
  recommendation_depth?: number;
};

export type Profile = {
  id: string;
  name: string;
};

export type ChannelResult = {
  id: string;
  name: string;
  thumbnailUrl?: string;
};

export type FeedResponse = {
  profile: Profile;
  videos: FeedVideo[];
  upNextByVideoId?: Record<string, string[]>;
};
