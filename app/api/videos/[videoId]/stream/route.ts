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
    const info = await youtube.getBasicInfo(videoId);
    const manifest = await info.toDash({
      manifest_options: {
        include_thumbnails: true
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
