const { Innertube } = require("youtubei.js");

function createMockVideos(query, count = 10) {
  const sanitized = String(query || "topic").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const videos = [];
  for (let i = 1; i <= count; i++) {
    videos.push({
      type: "Video",
      id: `clean-${sanitized}-${String(i).padStart(2, "0")}`,
      title: { text: `Clean Video ${i} for ${query}` },
      author: { name: "Clean Channel", id: "UC-clean-channel" },
      duration: { text: "10:00", seconds: 600 },
      view_count: { text: "1.5K views" },
      published: { text: "1 day ago" },
      publishedAt: Date.now() - 86400000,
      thumbnails: [{ url: "https://example.com/clean-thumb.jpg" }]
    });
  }
  return videos;
}

Innertube.create = async function() {
  return {
    async search(query, opts = {}) {
      if (opts.type === "channel") {
        return {
          channels: [
            {
              id: "UC-clean-channel",
              name: { text: "Clean Channel" },
              author: { name: "Clean Channel", id: "UC-clean-channel" },
              thumbnails: [{ url: "https://example.com/clean-channel.jpg" }]
            }
          ]
        };
      }
      const videos = createMockVideos(query, 12);
      return { results: videos, videos };
    },
    async getChannel(channelId) {
      const videos = createMockVideos("channel-seed", 8);
      return {
        metadata: {
          title: { text: "Clean Channel" },
          avatar: [{ url: "https://example.com/clean-channel.jpg" }]
        },
        async getVideos() {
          return { videos };
        }
      };
    },
    async getInfo(videoId) {
      return {
        get watch_next_feed() {
          return [];
        },
        async getTranscript() {
          return {
            transcript: {
              content: {
                body: {
                  initial_segments: [{ snippet: "systems architecture engineering" }]
                }
              }
            }
          };
        }
      };
    },
    async getSearchSuggestions() {
      return [];
    }
  };
};
