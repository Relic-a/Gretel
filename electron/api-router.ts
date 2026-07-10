import * as channelSearch from "../app/api/channels/search/route";
import * as comments from "../app/api/comments/route";
import * as config from "../app/api/config/route";
import * as feedBuild from "../app/api/feed/build/route";
import * as feed from "../app/api/feed/route";
import * as history from "../app/api/history/route";
import * as impressions from "../app/api/impressions/route";
import * as likedVideos from "../app/api/liked-videos/route";
import * as profiles from "../app/api/profiles/route";
import * as savedVideos from "../app/api/saved-videos/route";
import * as settings from "../app/api/settings/route";
import * as thumbnails from "../app/api/thumbnails/[profileId]/[videoId]/route";
import * as videoInfo from "../app/api/video-info/route";
import * as watchEvents from "../app/api/watch-events/route";

type RouteModule = {
  GET?: (request: Request) => Promise<Response> | Response;
  POST?: (request: Request) => Promise<Response> | Response;
};

const routes = new Map<string, RouteModule>([
  ["/api/channels/search", channelSearch], ["/api/comments", comments],
  ["/api/config", config], ["/api/feed/build", feedBuild], ["/api/feed", feed],
  ["/api/history", history], ["/api/impressions", impressions],
  ["/api/liked-videos", likedVideos], ["/api/profiles", profiles],
  ["/api/saved-videos", savedVideos], ["/api/settings", settings],
  ["/api/video-info", videoInfo], ["/api/watch-events", watchEvents]
]);

const thumbnailPattern = /^\/api\/thumbnails\/([^/]+)\/([^/]+)$/;

export async function routeApiRequest(request: Request) {
  const url = new URL(request.url);
  const thumbnailMatch = url.pathname.match(thumbnailPattern);

  if (thumbnailMatch) {
    return thumbnails.GET(request, { params: Promise.resolve({
      profileId: decodeURIComponent(thumbnailMatch[1]),
      videoId: decodeURIComponent(thumbnailMatch[2])
    }) });
  }

  const route = routes.get(url.pathname);
  const handler = route?.[request.method as "GET" | "POST"];

  if (!handler) return Response.json({ error: "Not found." }, { status: 404 });

  try {
    return await handler(request);
  } catch (error) {
    console.error("Gretel API request failed.", error);
    return Response.json({ error: "The request failed." }, { status: 500 });
  }
}
