import { saveWatchedVideo } from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    return Response.json({ error: "Invalid watch event." }, { status: 400 });
  }

  const saved = saveWatchedVideo({
    profileId,
    video,
    watchedSeconds,
    durationSeconds
  });

  return Response.json({ saved });
}
