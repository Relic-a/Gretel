import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelResult, FeedVideo } from "../types";

type Result = { channel: ChannelResult; sorts: string[]; videos: FeedVideo[]; cursor: { session: string; page: number } | null };
export function useChannelBrowser(profileId: string, input: string | null, fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const scope = JSON.stringify([profileId, input]);
  const [controls, setControls] = useState({ scope, sort: "", filter: false });
  const sort = controls.scope === scope ? controls.sort : "";
  const filter = controls.scope === scope ? controls.filter : false;
  const setSort = (sort: string) => setControls({ scope, sort, filter });
  const setFilter = (filter: boolean) => setControls({ scope, sort, filter });
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const busy = useRef(false);
  const failedMore = useRef(false);
  const cache = useRef(new Map<string, { time: number; result: Result }>());
  const key = JSON.stringify([profileId, input, sort, filter]);
  const request = useCallback(async (more = false, refresh = false, reload = false) => {
    if (!input || !profileId || busy.current) return;
    const current = generation.current;
    const cached = cache.current.get(key);
    if (!more && !refresh && cached && Date.now() - cached.time < 5 * 60_000) {
      setResult(cached.result);
      return;
    }
    const cursor = more ? cached?.result.cursor : undefined;
    if (more && !cursor) return;
    failedMore.current = more;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetcher("/api/channels/videos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, channel: input, sort, filter, cursor, refresh: reload }) });
      const data = await response.json();
      if (!response.ok) {
        if (current === generation.current && /session expired/i.test(data.error || "")) {
          failedMore.current = false;
          cache.current.delete(key);
        }
        throw new Error(data.error || "Could not load channel videos.");
      }
      if (current !== generation.current) return;
      const previous = more ? cached?.result.videos || [] : [];
      const seen = new Set(previous.map(video => video.id));
      const next: Result = { ...data, videos: [...previous, ...data.videos.filter((video: FeedVideo) => !seen.has(video.id))] };
      cache.current.delete(key);
      if (cache.current.size >= 24) cache.current.delete(cache.current.keys().next().value!);
      cache.current.set(key, { time: Date.now(), result: next });
      setResult(next);
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : "Could not load channel videos.");
    } finally {
      if (current === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [key, input, profileId, sort, filter, fetcher]);
  // Every newly opened channel starts with recency and filtering off.

  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setResult(null);
    setLoading(false);
    setError("");
    failedMore.current = false;
    void request();
    return () => { generation.current += 1; busy.current = false; };
  }, [request]);
  return { result, loading, error, sort, filter, setSort, setFilter,
    refresh: () => { cache.current.clear(); void request(false, true, true); },
    reset: () => setControls({ scope, sort: "", filter: false }),
    loadMore: () => void request(true), retry: () => void request(failedMore.current, true) };
}
