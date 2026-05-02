import { saveWatchedVideo } from "../../../lib/profile-store";
import { errorFields, logError, logInfo, logWarn } from "../../../lib/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const video = body.video && typeof body.video === "object" ? body.video : null;
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const watchedSeconds = Number(body.watchedSeconds);
    const durationSeconds = Number(body.durationSeconds);

    if (
      !profileId ||
      !video ||
      typeof video.id !== "string" ||
      !Number.isFinite(watchedSeconds) ||
      !Number.isFinite(durationSeconds)
    ) {
      logWarn("watch_event.invalid", {
        hasProfileId: Boolean(profileId),
        hasVideo: Boolean(video),
        watchedSecondsValid: Number.isFinite(watchedSeconds),
        durationSecondsValid: Number.isFinite(durationSeconds)
      });
      return Response.json({ error: "Invalid watch event." }, { status: 400 });
    }

    const saved = saveWatchedVideo({
      profileId,
      video,
      watchedSeconds,
      durationSeconds
    });

    if (saved) {
      logInfo("watch_event.saved", {
        profileId,
        videoId: video.id,
        sourceNodeId: typeof video.sourceNodeId === "string" ? video.sourceNodeId : "",
        watchedRatio: durationSeconds > 0 ? Number((watchedSeconds / durationSeconds).toFixed(3)) : 0
      });
    }

    return Response.json({ saved });
  } catch (error) {
    logError("watch_event.failed", errorFields(error, { stack: true }));
    return Response.json({ error: "Watch event failed." }, { status: 500 });
  }
}
