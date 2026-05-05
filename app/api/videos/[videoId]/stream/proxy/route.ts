import { getProfile } from "../../../../../../lib/profile-store";

export const runtime = "nodejs";

const allowedStreamHosts = [".googlevideo.com", ".youtube.com", ".youtube-nocookie.com"];

export async function GET(
  request: Request,
  context: { params: Promise<{ videoId: string }> }
) {
  await context.params;

  const requestUrl = new URL(request.url);
  const requestedProfileId = requestUrl.searchParams.get("profileId") || "";
  const streamUrlValue = requestUrl.searchParams.get("url") || "";
  const profile = requestedProfileId ? getProfile(requestedProfileId) : null;

  if (!profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  let streamUrl: URL;

  try {
    streamUrl = new URL(streamUrlValue);
  } catch {
    return Response.json({ error: "Invalid stream URL." }, { status: 400 });
  }

  if (!isAllowedStreamHost(streamUrl.hostname)) {
    return Response.json({ error: "Unsupported stream host." }, { status: 400 });
  }

  try {
    const headers = new Headers();
    const range = request.headers.get("range");

    if (range) {
      headers.set("range", range);
    }

    const upstream = await fetch(streamUrl, {
      headers,
      redirect: "follow"
    });
    const responseHeaders = new Headers();

    copyHeader(upstream.headers, responseHeaders, "content-type");
    copyHeader(upstream.headers, responseHeaders, "content-length");
    copyHeader(upstream.headers, responseHeaders, "content-range");
    copyHeader(upstream.headers, responseHeaders, "accept-ranges");
    responseHeaders.set("Cache-Control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch {
    return Response.json({ error: "Could not load this video segment." }, { status: 502 });
  }
}

function isAllowedStreamHost(hostname: string) {
  return allowedStreamHosts.some((allowedHost) =>
    allowedHost.startsWith(".")
      ? hostname === allowedHost.slice(1) || hostname.endsWith(allowedHost)
      : hostname === allowedHost
  );
}

function copyHeader(from: Headers, to: Headers, name: string) {
  const value = from.get(name);

  if (value) {
    to.set(name, value);
  }
}
