import { getPublicGretelConfig } from "../../../lib/feed/config";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(getPublicGretelConfig());
}
