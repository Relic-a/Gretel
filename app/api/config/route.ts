import { getPublicGretelConfig } from "../../../lib/feed/config";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json(getPublicGretelConfig());
}
