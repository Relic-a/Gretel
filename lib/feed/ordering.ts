import type { FeedVideo } from "./types";

/** Vary presentation within the selected page, preserving a strong rank preference. */
export function orderHomeVideos(
  rankedVideos: FeedVideo[],
  previousVideos: FeedVideo[] = [],
  random: () => number = Math.random
) {
  const remaining = [...rankedVideos];
  const ordered: FeedVideo[] = [];
  const recent = previousVideos.slice(-3);

  while (remaining.length > 0) {
    // A moving window keeps lower-ranked results from jumping to the top.
    const candidates = remaining.slice(0, 8);
    const weights = candidates.map((video, rank) => {
      let weight = Math.exp(-rank / 2);
      for (let index = 0; index < recent.length; index += 1) {
        const previous = recent[index];
        const recency = (index + 1) / recent.length;
        if (channel(video) && channel(video) === channel(previous)) {
          weight *= Math.pow(0.2, recency);
        }
        if (video.matchedTopic && video.matchedTopic === previous.matchedTopic) {
          weight *= Math.pow(0.55, recency);
        }
      }
      return weight;
    });
    let draw = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let selectedIndex = weights.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      draw -= weights[index];
      if (draw < 0) {
        selectedIndex = index;
        break;
      }
    }
    const [selected] = remaining.splice(selectedIndex, 1);
    ordered.push(selected);
    recent.push(selected);
    if (recent.length > 3) recent.shift();
  }

  return ordered;
}

function channel(video: FeedVideo) {
  return (video.channelId || video.channelKey || video.author || "").trim().toLowerCase();
}
