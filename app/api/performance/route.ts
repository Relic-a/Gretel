import { getPerformanceReport } from "../../../lib/performance-metrics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedHours = Number(url.searchParams.get("hours") || 24);
  const hours = Number.isFinite(requestedHours)
    ? Math.min(24 * 90, Math.max(1, Math.floor(requestedHours)))
    : 24;
  const profileId = cleanFilter(url.searchParams.get("profileId"));
  const workflow = cleanFilter(url.searchParams.get("workflow"));

  return Response.json(getPerformanceReport({
    sinceMs: Date.now() - hours * 60 * 60 * 1000,
    profileId,
    workflow
  }));
}

function cleanFilter(value: string | null) {
  const cleaned = value?.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : undefined;
}
