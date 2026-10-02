import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function module(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, crypto: { randomUUID }, Date, Map, Set, Response });
  return exports;
}
const { ChannelPager } = module("lib/feed/channel-pager.ts");
test("channel pager fetches only requested pages, coalesces retries, and respects exhaustion", async () => {
  let first = 0, next = 0;
  const pager = new ChannelPager(async () => { first++; return 0; }, async page => { next++; return page + 1; }, page => [page], page => page < 1);
  const a = pager.getPage(0);
  assert.equal(a, pager.getPage(0));
  assert.deepEqual(Array.from((await a).items), [0]);
  assert.equal(first, 1); assert.equal(next, 0);
  await pager.getPage(1); await pager.getPage(1);
  assert.equal(next, 1);
  assert.equal((await pager.getPage(2)).hasMore, false);
  assert.equal(next, 1);
  assert.throws(() => pager.getPage(4), /Invalid channel page/);
});
test("failed continuation can be retried without losing the preceding page", async () => {
  let calls = 0;
  const pager = new ChannelPager(async () => 0, async () => { if (++calls === 1) throw new Error("offline"); return 1; }, page => [page], page => page === 0);
  await pager.getPage(0);
  await assert.rejects(pager.getPage(1), /offline/);
  await pager.getPage(1);
  assert.equal(calls, 2);
});
function browserFixture(chips = false, modern = false) {
  let fetches = 0, continuations = 0, searches = 0, sorts = 0;
  const second = { videos: [{ id: "second" }], has_continuation: false };
  const first = { videos: [{ id: "newest" }], sort_filters: chips || modern ? [] : ["Newest", "Popular", "Oldest"], filters: chips && !modern ? ["Latest", "Popular", "Oldest"] : [], has_continuation: true,
    getContinuation: async () => { continuations++; return second; },
    applySort: async sort => { sorts++; return { ...first, videos: [{ id: sort }] }; },
    applyFilter: async sort => { sorts++; return { ...first, videos: [{ id: sort }] }; } };
  if (modern) first.memo = { getType: () => [{ chips: ["Latest", "Popular", "Oldest"].map(text => ({ text, endpoint: { call: async () => { sorts++; return { ...second, videos: [{ id: text }] }; } } })) }] };
  const channel = { metadata: { title: "Example" }, has_videos: true, getVideos: async () => first };
  const helpers = {
    getVideoId: video => video.id, getTitle: video => video.id, getDuration: () => "1:00", getPublishedAt: () => 1,
    getPublishedText: () => "today", getThumbnailUrl: () => "thumb", getViewCount: () => 3,
    getAuthorAvatarUrl: () => undefined, getChannelAvatarUrl: () => "avatar", getChannelVideoAuthor: (_, name) => name
  };
  const { browseChannel } = module("lib/feed/channel-browser.ts", {
    "youtubei.js": { YTNodes: { ChipBarView: class {} }, YT: { ChannelListContinuation: class { constructor(_, response) { Object.assign(this, response); } } } },
    "./channel-pager": { ChannelPager }, "./youtube-client": { getYoutubeClient: async () => ({ getChannel: async () => { fetches++; return channel; } }) },
    "./youtube": { searchChannels: async () => { searches++; return [{ id: "UCexample", name: "Example" }]; } },
    "./channel-utils": { getChannelIdFromInput: input => input.startsWith("UC") ? input : "", getChannelVideoItems: page => page.videos || [] },
    "./video-utils": helpers, "./channel-avatar-cache": { rememberChannelAvatar() {} }
  });
  return { browseChannel, counts: () => ({ fetches, continuations, searches, sorts }) };
}
test("channel browsing defaults to recency, skips ID resolution, and caches raw pages", async () => {
  const { browseChannel, counts } = browserFixture();
  const [a, b] = await Promise.all([browseChannel("p", "UCexample"), browseChannel("p", "UCexample")]);
  assert.equal(a.videos[0].id, "newest"); assert.equal(a.channel.id, "UCexample");
  assert.equal(a.cursor.session, b.cursor.session);
  assert.deepEqual(counts(), { fetches: 1, continuations: 0, searches: 0, sorts: 0 });
  const page = await browseChannel("p", "UCexample", "", a.cursor);
  assert.equal(page.videos[0].id, "second"); assert.equal(page.cursor, null);
  await browseChannel("p", "UCexample", "", a.cursor);
  assert.equal(counts().continuations, 1);
});
test("sort changes reuse the channel and support both YouTube sorting APIs", async () => {
  for (const chips of [true, false]) {
    const { browseChannel, counts } = browserFixture(chips);
    await browseChannel("p", "Example");
    const popular = await browseChannel("p", "Example", "Popular");
    assert.equal(popular.videos[0].id, "Popular");
    assert.deepEqual(counts(), { fetches: 1, continuations: 0, searches: 1, sorts: 1 });
    await assert.rejects(browseChannel("p", "Example", "bogus"), /unavailable/);
  }
});
test("explicit refresh fetches fresh data and invalidates older cursors", async () => {
  const { browseChannel, counts } = browserFixture();
  const old = await browseChannel("p", "UCexample");
  const fresh = await browseChannel("p", "UCexample", "", undefined, true);
  assert.notEqual(old.cursor.session, fresh.cursor.session);
  assert.equal(counts().fetches, 2);
  await assert.rejects(browseChannel("p", "UCexample", "", old.cursor), /expired/);
});
test("channel sessions are isolated by profile, channel, and sort", async () => {
  const { browseChannel } = browserFixture();
  const a = await browseChannel("a", "UCexample");
  await assert.rejects(browseChannel("b", "UCexample", "", a.cursor), /expired/);
  await assert.rejects(browseChannel("a", "UCother", "", a.cursor), /expired/);
  await assert.rejects(browseChannel("a", "UCexample", "Popular", a.cursor), /expired/);
});
test("channel endpoint filters only on explicit opt-in and rejects malformed inputs", async () => {
  let filters = 0, browsing = 0, authorized = true;
  const { POST } = module("app/api/channels/videos/route.ts", {
    "../../../../lib/api-auth": { verifyApiToken: () => authorized },
    "../../../../lib/managed-auth-context": { withManagedAuth: (_, action) => action() },
    "../../../../lib/profile-store": { getProfile: id => id === "p" ? { id } : null },
    "../../../../lib/feed/channel-browser": { browseChannel: async () => { browsing++; return { videos: [{ id: "a" }, { id: "b" }] }; } },
    "../../../../lib/feed/service": { filterChannelPage: async (_, videos) => { filters++; return videos.slice(1); } },
    "../../../../lib/feed/observation": { createFeedObservation: () => ({}), logFeedObservation() {} }
  });
  const request = body => new Request("http://localhost/api/channels/videos", { method: "POST", body: JSON.stringify(body) });
  const normal = await POST(request({ profileId: "p", channel: "Example" }));
  assert.equal((await normal.json()).videos.length, 2); assert.equal(filters, 0);
  const filtered = await POST(request({ profileId: "p", channel: "Example", filter: true }));
  assert.equal((await filtered.json()).videos.length, 1); assert.equal(filters, 1);
  for (const extra of [{ filter: "true" }, { refresh: "true" }, { sort: 4 }, { cursor: { session: "x", page: -1 } }, { profileId: "missing" }]) {
    assert.equal((await POST(request({ profileId: "p", channel: "Example", ...extra }))).status, 400);
  }
  authorized = false;
  assert.equal((await POST(request({ profileId: "p", channel: "Example" }))).status, 401);
  assert.equal(browsing, 2);
});

const videoUtils = module("lib/feed/video-utils.ts", { "./config": { getGretelConfig: () => ({}) } });
const { getChannelVideoItems } = module("lib/feed/channel-utils.ts", { "./video-utils": videoUtils });
test("modern channel cards survive an empty legacy getter and mixed pages without duplicates", () => {
  const video = { content_id: "modern", content_type: "VIDEO" };
  const playlist = { content_id: "playlist", content_type: "PLAYLIST" };
  const page = { videos: [], current_tab: { content: { contents: [{ content: video }, { content: playlist }] } }, memo: new Map([["LockupView", [video, playlist]]]) };
  assert.deepEqual(Array.from(getChannelVideoItems(page), videoUtils.getVideoId), ["modern"]);
  page.videos = [{ id: "legacy" }];
  assert.deepEqual(Array.from(getChannelVideoItems(page), videoUtils.getVideoId), ["legacy", "modern"]);
});
test("filtered and continuation pages extract modern cards from the parsed page memo", () => {
  for (const type of ["on_response_received_actions_memo", "on_response_received_endpoints_memo", "on_response_received_commands_memo"]) {
    const page = { videos: [], page: { [type]: new Map([["LockupView", [{ content_id: "next", content_type: "VIDEO" }]]]) } };
    assert.deepEqual(Array.from(getChannelVideoItems(page), videoUtils.getVideoId), ["next"]);
  }
  assert.equal(getChannelVideoItems({ videos: [] }).length, 0);
});
test("modern card view counts use metadata alongside publish time and title", () => {
  const card = { metadata: { title: "A video", metadata: { metadata_rows: [{ metadata_parts: [{ text: "12.3K views" }, { text: "2 days ago" }] }] } } };
  assert.equal(videoUtils.getViewCount(card), 12300);
  assert.equal(videoUtils.getPublishedText(card), "2 days ago");
  assert.equal(videoUtils.getTitle(card), "A video");
});
test("persisted impressions succeed even when optional expansion fails, with managed auth context", async () => {
  let auth = false;
  const { POST } = module("app/api/impressions/route.ts", {
    "../../../lib/logger": { logInfo() {}, logWarn() {} },
    "../../../lib/feed/input": { parseTags: x => x || [], parseChannelSort: () => "mixed" },
    "../../../lib/feed/observation": { createFeedObservation: () => ({}), logFeedObservation() {} },
    "../../../lib/feed/service": { expandFeedPoolForImpressions: async () => { assert.equal(auth, true); throw new Error("upstream unavailable"); } },
    "../../../lib/profile-store": { getProfile: () => ({ id: "p", updatedAt: 1 }), getWatchedVideoIds: () => [], recordVideoImpressions: () => 1 },
    "../../../lib/api-auth": { verifyApiToken: () => true },
    "../../../lib/managed-auth-context": { withManagedAuth: (_, action) => { auth = true; return action(); } }
  });
  const response = await POST(new Request("http://localhost/api/impressions", { method: "POST", body: JSON.stringify({ profileId: "p", tags: ["saas"], videoIds: ["video"] }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recorded: 1, expandedPool: false });
});
test("structured descriptions accept the new ItemSection wrapper without a parser warning", async () => {
  const { Parser } = await import("youtubei.js");
  const Description = Parser.getParserByName("StructuredDescriptionContent");
  const description = new Description({ items: [{ itemSectionRenderer: { contents: [], sectionIdentifier: "video-details-section" } }] });
  assert.equal(description.items.length, 1);
  assert.equal(description.items[0].type, "ItemSection");
});

test("modern ChipBarView sorting calls the selected endpoint and reads its continuation response", async () => {
  const { browseChannel, counts } = browserFixture(false, true);
  const latest = await browseChannel("p", "UCexample");
  assert.deepEqual(Array.from(latest.sorts), ["Latest", "Popular", "Oldest"]);
  const popular = await browseChannel("p", "UCexample", "Popular");
  assert.equal(popular.videos[0].id, "Popular");
  assert.equal(popular.cursor, null);
  assert.equal(counts().sorts, 1);
});

test("compact modern metadata preserves view counts and publication time", () => {
  const card = { metadata: { metadata: { metadata_rows: [{ metadata_parts: [{ text: "64K" }, { text: "5d ago" }] }] } } };
  assert.equal(videoUtils.getViewCount(card), 64000);
  assert.equal(videoUtils.getPublishedText(card), "5d ago");
  assert.ok(Math.abs(videoUtils.getPublishedAt(card) - (Date.now() - 5 * 86400000)) < 1000);
});
