import { readFileSync } from "node:fs";

import { getCachedThumbnailPath } from "../../../../../lib/feed/cache";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string; videoId: string }> }
) {
  const { profileId, videoId } = await context.params;

  try {
    return new Response(readFileSync(getCachedThumbnailPath(profileId, videoId)), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch {
    return Response.redirect(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
  }
}
