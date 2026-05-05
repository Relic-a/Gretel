import { getYoutubeClient } from "../../../../../lib/feed/youtube-client";
import { getProfile } from "../../../../../lib/profile-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await context.params;
  const url = new URL(request.url);
  const requestedProfileId = url.searchParams.get("profileId") || "";
  const profile = requestedProfileId ? getProfile(requestedProfileId) : null;

  if (!profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  try {
    const youtube = await getYoutubeClient(profile.id);
    const info = await youtube.getBasicInfo(videoId, { client: "ANDROID" });
    const manifest = await info.toDash({
      url_transformer: (streamUrl) => {
        const proxyUrl = new URL(`/api/videos/${encodeURIComponent(videoId)}/stream/proxy`, request.url);
        proxyUrl.searchParams.set("profileId", profile.id);
        proxyUrl.searchParams.set("url", streamUrl.toString());
        return proxyUrl;
      },
      manifest_options: {
        include_thumbnails: false
      }
    });

    return new Response(manifest, {
      headers: {
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return Response.json({ error: "Could not load this video stream." }, { status: 500 });
  }
}
