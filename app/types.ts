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
};
