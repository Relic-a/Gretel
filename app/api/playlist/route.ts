import { verifyApiToken } from "../../../lib/api-auth";
import { getPlaylistDetails } from "../../../lib/feed/playlists";
import { isPlaylistAdmitted } from "../../../lib/feed/playlist-store";
import { getProfile } from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId") || "";
  const playlistId = url.searchParams.get("playlistId") || "";
  // The card carries playlistPoolKey; poolKey is kept as an accepted alias.
  const poolKey = url.searchParams.get("playlistPoolKey") || url.searchParams.get("poolKey") || "";

  if (!getProfile(profileId)) {
    return Response.json({ error: "Select a profile first." }, { status: 400 });
  }
  if (!/^[\w-]{10,}$/.test(playlistId) || !poolKey) {
    return Response.json({ error: "Choose a valid playlist." }, { status: 400 });
  }
  if (!isPlaylistAdmitted(profileId, poolKey, playlistId)) {
    return Response.json({ error: "Playlist was not admitted to this feed." }, { status: 404 });
  }

  try {
    return Response.json(await getPlaylistDetails(profileId, poolKey, playlistId));
  } catch {
    return Response.json({ error: "Could not load this playlist." }, { status: 502 });
  }
}
