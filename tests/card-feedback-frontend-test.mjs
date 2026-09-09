import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

function read(relative) {
  return readFileSync(new URL(relative, root), "utf8");
}

test("card menus expose all three canonical feedback actions with scope copy", () => {
  const actions = read("app/components/VideoActions.tsx");
  for (const action of ["notInterested", "hideVideo", "muteChannel"]) {
    assert.match(actions, new RegExp(action), `VideoActions must include ${action}`);
  }
  assert.match(actions, /Not interested/, "menu needs the Not interested label");
  assert.match(actions, /Hide this video/, "menu needs the Hide this video label");
  assert.match(actions, /Mute channel|Mute \$/m, "menu needs the mute-channel label");
  assert.match(actions, /Fewer like this/, "menu must state not-interested scope");
  assert.match(actions, /Removes it now/, "menu must state hide scope");
  assert.match(actions, /Hides all their videos/, "menu must state destructive mute scope");
  assert.match(actions, /role="menu"/, "menu must expose a menu role");
  assert.match(actions, /role="menuitem"/, "menu items must expose menuitem roles");
  assert.match(actions, /aria-label/, "menu must label actions for screen readers");
  assert.match(actions, /Escape/, "menu must support Escape dismissal");
  assert.match(actions, /pendingAction/, "menu must render pending feedback state");
  assert.match(actions, /confirmingMute|Mute .*channelName/, "mute must require confirmation");
});

test("feed, cards, and watch view wire optimistic feedback through", () => {
  const page = read("app/page.tsx");
  assert.match(page, /submitContentFeedback/, "page must own the feedback submission");
  assert.match(page, /feedbackTargetIds/, "page must compute optimistic removal targets");
  assert.match(page, /Optimistic removal/, "removal must be optimistic");
  assert.match(page, /requestFeed\(\{\s*resetFeed:\s*true,\s*buildIfMissing:\s*true/, "feed must refill after feedback");
  assert.match(page, /feedbackSnapshotRef/, "failed feedback must restore a snapshot");
  assert.match(page, /Try again/, "failed feedback must offer recovery");
  assert.match(page, /role="status"|role="alert"/, "feedback toast must announce politely");
  assert.match(page, /feedbackToastCopy/, "toast copy must come from the scope-preserving helper");

  const feed = read("app/components/FeedView.tsx");
  assert.match(feed, /onFeedback/, "FeedView must forward feedback callbacks");
  assert.match(feed, /feedbackPendingVideoId|feedbackPendingAction/, "FeedView must forward pending state");

  const card = read("app/components/VideoCard.tsx");
  assert.match(card, /onFeedback/, "VideoCard must forward feedback callbacks");

  const watch = read("app/components/WatchView.tsx");
  assert.match(watch, /watch-feedback-menu/, "watch header needs its own feedback menu");
  assert.match(watch, /side-feedback-menu/, "Up next rows need per-row feedback menus");
  assert.match(watch, /side-video-row/, "Up next rows must keep responsive placement");
  assert.match(
    watch,
    /onFeedback\?\.\("notInterested"[\s\S]*?onFeedback\?\.\("hideVideo"[\s\S]*?onFeedback\?\.\("muteChannel"/,
    "watch view must offer all three actions in both placements"
  );
  assert.doesNotMatch(
    watch,
    /PlayerState\.ENDED[\s\S]{0,300}onFeedback/,
    "feedback must not disturb the ended-state no-autoplay invariant"
  );
});

test("feedback helpers preserve saved/history scope and use canonical actions", () => {
  const helper = read("app/components/feedback-client.ts");
  assert.match(helper, /notInterested/, "helper must include notInterested");
  assert.match(helper, /hideVideo/, "helper must include hideVideo");
  assert.match(helper, /muteChannel/, "helper must include muteChannel");
  assert.match(helper, /channelMatchesVideo/, "helper must match muted channels across rows");
  assert.match(helper, /feedbackTargetIds/, "helper must compute optimistic targets");
  assert.match(helper, /buildFeedbackPayload/, "helper must build the backend payload");
  assert.match(helper, /videoId: video\.id/, "payload must carry the video id");
  assert.match(helper, /channelName: video\.author/, "payload must carry the channel name");
  assert.match(helper, /Saved videos and history are kept/, "helper must preserve saved/history scope");

  const styles = read("app/styles.css");
  assert.match(styles, /\.feedback-toast/, "toast needs product styling");
  assert.match(styles, /\.actions-danger/, "destructive mute needs distinct styling");
  assert.match(styles, /\.side-video-row/, "Up next rows need responsive placement styling");
  assert.match(styles, /prefers-reduced-motion/, "motion must respect reduced-motion");
});

console.log("card feedback frontend tests passed");
