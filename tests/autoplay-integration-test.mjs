import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/components/WatchView.tsx", import.meta.url), "utf8");

assert.match(source, /autoplay:\s*1/, "selected videos should start automatically");
assert.match(
  source,
  /event\.data\s*===\s*window\.YT\?\.PlayerState\.ENDED[\s\S]*?event\.target\.stopVideo\(\)/,
  "an ended video must remain stopped instead of advancing"
);
assert.doesNotMatch(
  source,
  /PlayerState\.ENDED[\s\S]{0,300}onSelectVideo/,
  "the ended-state handler must not select the next video"
);

console.log("autoplay integration test passed");
