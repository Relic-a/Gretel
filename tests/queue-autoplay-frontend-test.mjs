import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

const watchSource = read("app/components/WatchView.tsx");
const queuePanelSource = read("app/components/QueuePanel.tsx");
const queueHookSource = read("app/components/use-playback-queue.ts");
const pageSource = read("app/page.tsx");
const actionsSource = read("app/components/VideoActions.tsx");
const feedViewSource = read("app/components/FeedView.tsx");
const stylesSource = read("app/styles.css");

// The queue hook talks to the backend contract: GET snapshot plus every
// POST action the route supports.
for (const action of ["enqueue", "remove", "reorder", "clear", "current", "autoplay", "next", "ended"]) {
  assert.match(
    queueHookSource,
    new RegExp(`"${action}"`),
    `queue hook must support the ${action} action`
  );
}
assert.match(queueHookSource, /\/api\/queue\?profileId=/, "queue hook must load the GET snapshot");

// YouTube ENDED resolves through the ended action, never next, and the player stays stopped.
assert.match(watchSource, /event\.target\.stopVideo\(\)/, "ended video must remain stopped");
assert.match(watchSource, /props\.onVideoEnded\?\.\(\)/, "WatchView must notify the page on ENDED");
assert.match(pageSource, /queue\.resolveEnded\(\)/, "page must resolve ENDED through the ended action");
assert.match(
  pageSource,
  /transition\?\.kind === "advanced" && transition\.video/,
  "page must only select the returned video for advanced transitions"
);
assert.doesNotMatch(
  pageSource,
  /handlePlayerEnded[\s\S]{0,400}advanceNext/,
  "ENDED handling must not use the explicit next action"
);

// The Next button advances explicitly and selects only advanced transitions.
assert.match(pageSource, /queue\.advanceNext\(\)/, "Next button must use the next action");
assert.match(queuePanelSource, /onPlayNext/, "queue panel must expose a Next control");
assert.match(queuePanelSource, /disabled=\{[^}]*upNext\.length === 0\}/, "Next must disable with nothing up next");

// Autoplay toggle is wired to the backend and explains the off state.
assert.match(queuePanelSource, /onToggleAutoplay/, "queue panel must expose the autoplay toggle");
assert.match(pageSource, /queue\.setAutoplay\(enabled\)/, "autoplay toggle must persist to the backend");
assert.match(
  queuePanelSource,
  /Autoplay is off/,
  "queue panel must explain the disabled/autoplay-off state"
);

// Reorder, remove, and clear controls exist with accessible labels.
for (const label of [/Move .* earlier/, /Move .* later/, /Remove .* from the queue/, /Clear queue/]) {
  assert.match(queuePanelSource, label, `queue panel must include control matching ${label}`);
}
assert.match(pageSource, /queue\.move\(videoId, toIndex\)/, "reorder must persist to the backend");
assert.match(pageSource, /queue\.remove\(videoId\)/, "remove must persist to the backend");
assert.match(pageSource, /queue\.clear\(\)/, "clear must persist to the backend");

// Loading, empty, and error states are all rendered.
assert.match(queuePanelSource, /Loading your queue/, "queue panel must render a loading state");
assert.match(queuePanelSource, /Nothing queued yet/, "queue panel must render an empty state");
assert.match(queuePanelSource, /role="alert"/, "queue panel must surface errors as an alert");
assert.match(queuePanelSource, /aria-current/, "current queue item must be exposed to assistive tech");
assert.match(queuePanelSource, /aria-label="Playback queue"/, "queue panel must be labelled");

// Queue entry points exist on feed cards, side videos, and the actions menu.
assert.match(actionsSource, /onEnqueueVideo/, "actions menu must offer queueing");
assert.match(feedViewSource, /onEnqueueVideo/, "feed cards must offer queueing");
assert.match(watchSource, /onEnqueueVideo\(video\)/, "side videos must offer queueing");
assert.match(watchSource, /QueuePanel/, "watch surface must render the queue panel");

// Queue styles cover the panel, items, and responsive states.
for (const selector of [".queue-panel", ".queue-list", ".queue-item", ".queue-thumb", ".queue-foot"]) {
  assert.ok(stylesSource.includes(selector), `styles must define ${selector}`);
}
assert.match(stylesSource, /@media \(max-width: 560px\)[\s\S]*?\.queue-item/, "queue must adapt to small screens");
assert.match(
  stylesSource,
  /prefers-reduced-motion: reduce[\s\S]*?\.queue-next-button/,
  "queue must respect reduced motion"
);

// Selecting a queued video keeps the backend cursor in sync.
assert.match(pageSource, /queue\.setCurrentIfQueued\(video\.id\)/, "selecting a video must sync the queue cursor");

console.log("queue and autoplay frontend tests passed");
