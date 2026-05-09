import { getUserSettings, setUserSettings } from "../../../lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(toClientSettings(getUserSettings()));
}

export async function POST(request: Request) {
  const body = await request.json();

  setUserSettings({
    openRouterApiKey: typeof body.openRouterApiKey === "string" ? body.openRouterApiKey : "",
    openRouterModel: typeof body.openRouterModel === "string" ? body.openRouterModel : ""
  });

  return Response.json(toClientSettings(getUserSettings()));
}

function toClientSettings(settings: ReturnType<typeof getUserSettings>) {
  return {
    openRouterApiKey: settings.openRouterApiKey ? "set" : "",
    openRouterModel: settings.openRouterModel || ""
  };
}
