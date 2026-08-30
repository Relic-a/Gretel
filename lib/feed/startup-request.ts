export const FEED_POOL_MISSING_CODE = "FEED_POOL_MISSING";

type FeedFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchStartupFeed(
  fetcher: FeedFetcher,
  body: Record<string, unknown>
) {
  const serveResponse = await postFeed(fetcher, "/api/feed", body);

  if (
    serveResponse.response.status !== 404 ||
    serveResponse.data?.code !== FEED_POOL_MISSING_CODE
  ) {
    return { ...serveResponse, source: "persisted_pool" as const };
  }

  const buildResponse = await postFeed(fetcher, "/api/feed/build", {
    ...body,
    requestReason: "missing_pool_fallback"
  });
  return { ...buildResponse, source: "initial_build" as const };
}

async function postFeed(
  fetcher: FeedFetcher,
  endpoint: string,
  body: Record<string, unknown>
) {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data };
}
