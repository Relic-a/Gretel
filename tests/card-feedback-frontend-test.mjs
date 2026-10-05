import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("Home video menu includes queue, save, and recommendation actions", () => {
  const source = read("app/components/VideoActions.tsx");
  for (const text of ["Not interested", "Hide from feed", "Don't recommend channel"]) assert.match(source, new RegExp(text));
  assert.doesNotMatch(source, /Tune recommendations|Fewer like this|Removes it now/);
  assert.doesNotMatch(source, /<Heart/);
  assert.match(source, /<Bookmark/);
  assert.match(source, /<ListPlus/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /role="menu"/);
  assert.match(source, /Escape/);
});
test("Save and queue are keyboard-discoverable dropdown actions", () => {
  const card = read("app/components/VideoCard.tsx");
  assert.doesNotMatch(card, /card-quick-actions|quick-action/);
  assert.match(card, /onEnqueueVideo=\{props.onEnqueueVideo\}/);
  assert.match(card, /onSaveVideo=\{props.onSaveVideo\}/);
  const actions = read("app/components/VideoActions.tsx");
  assert.match(actions, /Add to queue/);
  assert.match(actions, /Add playlist to queue/);
  assert.match(actions, /In your queue/);
  assert.match(actions, /Remove from saved/);
  assert.match(actions, /props.onEnqueueVideo\?\.\(props.video\);\s+closeMenu\(\)/);
  assert.match(actions, /props.onSaveVideo\?\.\(props.video\);\s+closeMenu\(\)/);
  const page = read("app/gretel-app.tsx");
  assert.match(page, /showSaveNotice/);
  assert.doesNotMatch(page, /setSaveDialog\(\{[\s\S]{0,200}toggleSave/);
  const css = read("app/styles.css");
  assert.match(css, /video-actions summary:focus-visible/);
});
test("feedback keeps the existing optimistic recovery path", () => {
  const page = read("app/gretel-app.tsx");
  for (const token of ["submitContentFeedback", "feedbackTargetIds", "feedbackSnapshotRef", "Try again"]) assert.match(page, new RegExp(token));
});
