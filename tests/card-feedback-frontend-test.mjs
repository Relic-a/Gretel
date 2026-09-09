import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("Home feedback menu is short and recommendation-only", () => {
  const source = read("app/components/VideoActions.tsx");
  for (const text of ["Not interested", "Hide from feed", "Don't recommend channel"]) assert.match(source, new RegExp(text));
  assert.doesNotMatch(source, /Tune recommendations|Fewer like this|Removes it now/);
  assert.doesNotMatch(source, /<Heart|<Bookmark|ListPlus/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /role="menu"/);
  assert.match(source, /Escape/);
});
test("Save and queue are keyboard-discoverable card actions", () => {
  const card = read("app/components/VideoCard.tsx");
  assert.match(card, /card-quick-actions/);
  assert.match(card, /Add to queue|Queue/);
  assert.match(card, /Save/);
  const page = read("app/page.tsx");
  assert.match(page, /showSaveNotice/);
  assert.doesNotMatch(page, /setSaveDialog\(\{[\s\S]{0,200}toggleSave/);
  const css = read("app/styles.css");
  assert.match(css, /video-card:focus-within .card-quick-actions/);
});
test("feedback keeps the existing optimistic recovery path", () => {
  const page = read("app/page.tsx");
  for (const token of ["submitContentFeedback", "feedbackTargetIds", "feedbackSnapshotRef", "Try again"]) assert.match(page, new RegExp(token));
});
