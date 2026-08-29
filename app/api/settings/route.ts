import { getUserSettings, setUserSettings } from "../../../lib/settings";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json(toClientSettings(getUserSettings()));
}

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const current = getUserSettings();
    const openRouterApiKey =
      body.openRouterApiKey === "set"
        ? current.openRouterApiKey || ""
        : typeof body.openRouterApiKey === "string"
        ? body.openRouterApiKey
        : "";

    setUserSettings({
      openRouterApiKey,
      openRouterModel: typeof body.openRouterModel === "string" ? body.openRouterModel : ""
    });

    return Response.json(toClientSettings(getUserSettings()));
  } catch (error) {
    return Response.json({ error: "Could not save settings." }, { status: 500 });
  }
}

function toClientSettings(settings: ReturnType<typeof getUserSettings>) {
  return {
    openRouterApiKey: settings.openRouterApiKey ? "set" : "",
    openRouterModel: settings.openRouterModel || ""
  };
}
