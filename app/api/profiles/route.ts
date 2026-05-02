import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  resetProfile
} from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ profiles: listProfiles() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const action = typeof body.action === "string" ? body.action : "create";

  if (action === "reset") {
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const profile = getProfile(profileId);

    if (!profile) {
      return Response.json({ error: "Profile not found." }, { status: 404 });
    }

    resetProfile(profile.id);
    return Response.json({ profiles: listProfiles(), profileId: profile.id });
  }

  if (action === "delete") {
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const fallbackProfile = deleteProfile(profileId);
    return Response.json({ profiles: listProfiles(), profileId: fallbackProfile?.id || "" });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const profile = createProfile(name);
  return Response.json({ profiles: listProfiles(), profileId: profile.id });
}
