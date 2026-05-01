import { Innertube } from "youtubei.js";

let youtubeClient: Promise<Innertube> | null = null;

export function getYoutubeClient() {
  if (!youtubeClient) {
    youtubeClient = Innertube.create();
  }

  return youtubeClient;
}

