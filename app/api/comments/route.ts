import { getYoutubeClient } from "../../../lib/feed/youtube-client";

export const runtime = "nodejs";

// In-memory cache of comment page objects keyed by videoId.
// Each entry tracks how many continuations have been fetched (max 10).
const commentsCache = new Map<
  string,
  { page: any; pageCount: number }
>();

// Clean up cache entries after 5 minutes of inactivity
const cacheTimers = new Map<string, NodeJS.Timeout>();

function scheduleCleanup(videoId: string) {
  const existing = cacheTimers.get(videoId);
  if (existing) clearTimeout(existing);
  cacheTimers.set(
    videoId,
    setTimeout(() => {
      commentsCache.delete(videoId);
      cacheTimers.delete(videoId);
    }, 5 * 60 * 1000)
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const page = typeof body.page === "number" ? body.page : 0;

    if (!videoId || !profileId) {
      return Response.json({ error: "Missing videoId or profileId." }, { status: 400 });
    }

    const youtube = await getYoutubeClient(profileId);

    let description = "";

    // Page 0: first fetch — get description + initial comments
    if (page === 0) {
      // Fetch video description
      try {
        const info = await youtube.getInfo(videoId);
        description = info.secondary_info?.description?.toString() ?? "";
      } catch {
        // Description is optional, proceed without it
      }

      // Fetch first page of comments
      const commentsPage = await youtube.getComments(videoId);
      commentsCache.set(videoId, { page: commentsPage, pageCount: 0 });
      scheduleCleanup(videoId);

      const comments = extractComments(commentsPage);
      const hasMore = commentsPage.has_continuation && commentsCache.get(videoId)!.pageCount < 10;

      return Response.json({
        comments,
        description,
        page: 0,
        hasMore,
      });
    }

    // Page > 0: advance continuation from cache
    const cached = commentsCache.get(videoId);
    if (!cached) {
      return Response.json({ error: "Session expired. Please refresh comments." }, { status: 400 });
    }

    if (cached.pageCount >= 10) {
      return Response.json({
        comments: [],
        description: "",
        page,
        hasMore: false,
      });
    }

    if (!cached.page.has_continuation) {
      return Response.json({
        comments: [],
        description: "",
        page,
        hasMore: false,
      });
    }

    const nextPage = await cached.page.getContinuation();
    cached.page = nextPage;
    cached.pageCount++;
    scheduleCleanup(videoId);

    const comments = extractComments(nextPage);
    const hasMore = nextPage.has_continuation && cached.pageCount < 10;

    return Response.json({
      comments,
      description: "",
      page: cached.pageCount,
      hasMore,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch comments." },
      { status: 500 }
    );
  }
}

function extractComments(page: any) {
  const results: Array<{
    author: string;
    authorAvatarUrl?: string;
    content: string;
    published: string;
    likes: string;
    isPinned: boolean;
    authorIsOwner: boolean;
  }> = [];

  for (const thread of page.contents) {
    const comment = thread.comment;
    if (!comment) continue;

    const authorAvatarUrl = comment.author?.thumbnails && Array.isArray(comment.author.thumbnails) && comment.author.thumbnails.length > 0
      ? String(comment.author.thumbnails[0].url ?? "")
      : undefined;

    results.push({
      author: comment.author?.name?.toString() ?? "Unknown",
      authorAvatarUrl: authorAvatarUrl || comment.creator_thumbnail_url || undefined,
      content: comment.content?.toString() ?? "",
      published: comment.published_time ?? "",
      likes: comment.like_count ?? "0",
      isPinned: comment.is_pinned ?? false,
      authorIsOwner: comment.author_is_channel_owner ?? false,
    });
  }

  return results;
}
