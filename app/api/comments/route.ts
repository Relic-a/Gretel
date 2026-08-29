import { getYoutubeClient } from "../../../lib/feed/youtube-client";
import { getText } from "../../../lib/feed/video-utils";
import { errorFields, logDebug, logError, requestFields } from "../../../lib/logger";
import {
  createPerformanceTrace,
  observePerformanceOperation,
  persistPerformanceTrace
} from "../../../lib/performance-metrics";
import { verifyApiToken } from "../../../lib/api-auth";

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
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let trace = createPerformanceTrace("comments.unknown");
  try {
    const body = await request.json();
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const page = typeof body.page === "number" ? body.page : 0;
    trace = createPerformanceTrace(page === 0 ? "comments.initial" : "comments.continuation", {
      profileId
    });

    if (!videoId || !profileId) {
      return Response.json({ error: "Missing videoId or profileId." }, { status: 400 });
    }

    const youtube = await observePerformanceOperation(
      trace,
      "comments.youtube_client",
      {},
      () => getYoutubeClient(profileId)
    );

    let description = "";

    // Page 0: first fetch — get description + initial comments
    if (page === 0) {
      // Fetch video description
      try {
        const info = await observePerformanceOperation(
          trace,
          "comments.description_fetch",
          {},
          () => youtube.getInfo(videoId)
        );
        description = info.secondary_info?.description?.toString() ?? "";
      } catch (error) {
        // Description is optional, proceed without it
        logDebug("comments.description_unavailable", requestFields(request, {
          videoId,
          profileId,
          ...errorFields(error)
        }));
      }

      // Fetch first page of comments
      const commentsPage = await observePerformanceOperation(
        trace,
        "comments.page_fetch",
        { page: 0 },
        () => youtube.getComments(videoId)
      );
      commentsCache.set(videoId, { page: commentsPage, pageCount: 0 });
      scheduleCleanup(videoId);

      const comments = extractComments(commentsPage);
      const hasMore = commentsPage.has_continuation && commentsCache.get(videoId)!.pageCount < 10;

      persistPerformanceTrace(trace, { page: 0, comments: comments.length, hasMore }, { status: "ok" });
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
      persistPerformanceTrace(trace, { page, cacheMiss: true }, { status: "error" });
      return Response.json({ error: "Session expired. Please refresh comments." }, { status: 400 });
    }

    if (cached.pageCount >= 10) {
      persistPerformanceTrace(trace, { page, comments: 0, hasMore: false, limitReached: true }, { status: "ok" });
      return Response.json({
        comments: [],
        description: "",
        page,
        hasMore: false,
      });
    }

    if (!cached.page.has_continuation) {
      persistPerformanceTrace(trace, { page, comments: 0, hasMore: false }, { status: "ok" });
      return Response.json({
        comments: [],
        description: "",
        page,
        hasMore: false,
      });
    }

    const nextPage = await observePerformanceOperation(
      trace,
      "comments.page_fetch",
      { page },
      () => cached.page.getContinuation()
    );
    cached.page = nextPage;
    cached.pageCount++;
    scheduleCleanup(videoId);

    const comments = extractComments(nextPage);
    const hasMore = nextPage.has_continuation && cached.pageCount < 10;

    persistPerformanceTrace(trace, { page: cached.pageCount, comments: comments.length, hasMore }, { status: "ok" });
    return Response.json({
      comments,
      description: "",
      page: cached.pageCount,
      hasMore,
    });
  } catch (error) {
    persistPerformanceTrace(trace, { ...errorFields(error) }, { status: "error" });
    logError("comments.failed", requestFields(request, {
      ...errorFields(error, { stack: true })
    }));
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

    const authorThumbnails = comment.author?.thumbnails ?? comment.author_thumbnails;
    const authorAvatarUrl = extractThumbnailUrl(authorThumbnails);

    results.push({
      author: comment.author?.name?.toString() ?? "Unknown",
      authorAvatarUrl,
      content: comment.content?.toString() ?? "",
      published: comment.published_time ?? "",
      likes: comment.like_count ?? "0",
      isPinned: comment.is_pinned ?? false,
      authorIsOwner: comment.author_is_channel_owner ?? false,
    });
  }

  return results;
}

function extractThumbnailUrl(thumbnails: unknown) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return undefined;
  }

  let bestUrl = "";
  let bestScore = -1;

  for (const thumbnail of thumbnails) {
    if (!thumbnail || typeof thumbnail !== "object") {
      continue;
    }

    const rawUrl = "url" in thumbnail ? getText((thumbnail as Record<string, unknown>).url) : "";
    const normalizedUrl = normalizeThumbnailUrl(rawUrl);

    if (!normalizedUrl) {
      continue;
    }

    const width = typeof (thumbnail as Record<string, unknown>).width === "number"
      ? ((thumbnail as Record<string, unknown>).width as number)
      : 0;
    const height = typeof (thumbnail as Record<string, unknown>).height === "number"
      ? ((thumbnail as Record<string, unknown>).height as number)
      : 0;

    let score = width * height || width;
    if (score === 0) {
      const sMatch = normalizedUrl.match(/=s(\d+)/);
      if (sMatch) {
        const s = parseInt(sMatch[1], 10);
        if (!Number.isNaN(s)) {
          score = s * s;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestUrl = normalizedUrl;
    }
  }

  return bestUrl || undefined;
}

function normalizeThumbnailUrl(url: string) {
  if (!url) {
    return "";
  }

  return url.startsWith("//") ? `https:${url}` : url;
}
