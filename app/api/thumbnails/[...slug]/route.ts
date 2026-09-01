import { getOrFetchThumbnail } from "../../../../lib/feed/thumbnails";

const validId = /^[a-zA-Z0-9_-]{1,120}$/;

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await context.params;

  if (!Array.isArray(slug) || slug.length === 0 || slug.length > 2) {
    return new Response("Invalid thumbnail route", { status: 400 });
  }

  // If 1 segment: /api/thumbnails/:videoId -> videoId is slug[0]
  // If 2 segments: /api/thumbnails/:profileId/:videoId -> videoId is slug[1]
  const videoId = slug.length === 1 ? slug[0] : slug[1];

  if (!validId.test(videoId)) {
    return new Response("Invalid ID", { status: 400 });
  }

  const urlParam = new URL(request.url).searchParams.get("url") || undefined;

  try {
    const result = await getOrFetchThumbnail(videoId, urlParam);

    if (result) {
      return new Response(new Uint8Array(result.buffer), {
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=2592000, immutable"
        }
      });
    }

    return Response.redirect(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
  } catch {
    return Response.redirect(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
  }
}
