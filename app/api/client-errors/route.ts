import { errorFields, logError, requestFields } from "../../../lib/logger";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return new Response(null, { status: 401 });
  }

  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message : "Unknown client error";
    const source = typeof body?.source === "string" ? body.source : "unknown";
    const stack = typeof body?.stack === "string" ? body.stack : undefined;

    logError("client.error", requestFields(request, {
      source,
      message,
      ...(stack ? { errorStack: stack } : {}),
      url: typeof body?.url === "string" ? body.url : undefined,
      line: typeof body?.line === "number" ? body.line : undefined,
      column: typeof body?.column === "number" ? body.column : undefined
    }));
    return new Response(null, { status: 204 });
  } catch (error) {
    // Reporting must never turn into another user-facing failure.
    logError("client.error_report_failed", errorFields(error, { stack: true }));
    return new Response(null, { status: 204 });
  }
}
