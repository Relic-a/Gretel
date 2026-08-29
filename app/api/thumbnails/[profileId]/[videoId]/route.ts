import { readFileSync } from "node:fs";

import { getCachedThumbnailPath } from "../../../../../lib/feed/thumbnails";

const validId = /^[a-zA-Z0-9_-]{1,120}$/;

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string; videoId: string }> }
) {
  const { profileId, videoId } = await context.params;

  if (!validId.test(profileId) || !validId.test(videoId)) {
    return new Response("Invalid ID", { status: 400 });
  }

  try {
    return new Response(readFileSync(getCachedThumbnailPath(profileId, videoId)), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch {
    return Response.redirect(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`);
  }
}
