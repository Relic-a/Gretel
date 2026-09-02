#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const youtubeiDir = path.join(projectRoot, "node_modules", "youtubei.js");

if (!fs.existsSync(youtubeiDir)) {
  console.log("[patch-dependencies] youtubei.js is not installed yet; skipping patch.");
  process.exit(0);
}

let patchedCount = 0;

// 1. Patch dist/src/parser/classes/comments/CommentView.js
const commentViewPath = path.join(
  youtubeiDir,
  "dist",
  "src",
  "parser",
  "classes",
  "comments",
  "CommentView.js"
);

if (fs.existsSync(commentViewPath)) {
  let content = fs.readFileSync(commentViewPath, "utf8");

  if (content.includes("comment.avatar?.endpoint || comment.author?.channelCommand")) {
    console.log("[patch-dependencies] CommentView.js is already patched.");
  } else {
    const unpatchedPattern =
      /this\.author\s*=\s*new\s+Author\(\{\s*simpleText:\s*comment\.author\.displayName,\s*navigationEndpoint:\s*comment\.avatar\.endpoint\s*\}, comment\.author, comment\.avatar\.image, comment\.author\.channelId\);/;

    const replacement = `let thumbs = comment.avatar?.image;
            if (!thumbs && comment.author && ('avatarThumbnailUrl' in comment.author || Reflect.has(comment.author, 'avatarThumbnailUrl'))) {
                thumbs = { thumbnails: [{ url: comment.author.avatarThumbnailUrl, width: 88, height: 88 }] };
            }
            this.author = new Author({
                simpleText: comment.author?.displayName,
                navigationEndpoint: comment.avatar?.endpoint || comment.author?.channelCommand
            }, comment.author, thumbs, comment.author?.channelId);`;

    if (unpatchedPattern.test(content)) {
      content = content.replace(unpatchedPattern, replacement);
      content = content.replace(
        /this\.is_member = !!comment\.author\.sponsorBadgeUrl;\s*if \(Reflect\.has\(comment\.author, 'sponsorBadgeUrl'\)\) \{/g,
        `this.is_member = !!comment.author?.sponsorBadgeUrl;\n            if (comment.author && Reflect.has(comment.author, 'sponsorBadgeUrl')) {`
      );
      fs.writeFileSync(commentViewPath, content, "utf8");
      console.log("[patch-dependencies] Successfully patched CommentView.js");
      patchedCount++;
    } else {
      console.warn("[patch-dependencies] Could not find target pattern in CommentView.js");
    }
  }
}

// 2. Patch bundle files if present
const bundleFiles = ["browser.js", "cf-worker.js", "react-native.js"];
for (const bundleName of bundleFiles) {
  const bundlePath = path.join(youtubeiDir, "bundle", bundleName);
  if (!fs.existsSync(bundlePath)) continue;

  let content = fs.readFileSync(bundlePath, "utf8");
  if (content.includes("comment.avatar?.endpoint || comment.author?.channelCommand")) {
    console.log(`[patch-dependencies] bundle/${bundleName} is already patched.`);
    continue;
  }

  const bundleUnpatchedPattern =
    /this\.author\s*=\s*new\s+Author\(\{\s*simpleText:\s*comment\.author\.displayName,\s*navigationEndpoint:\s*comment\.avatar\.endpoint\s*\}, comment\.author, comment\.avatar\.image, comment\.author\.channelId\);/;

  const bundleReplacement = `var thumbs = comment.avatar?.image;
      if (!thumbs && comment.author && ('avatarThumbnailUrl' in comment.author || Reflect.has(comment.author, 'avatarThumbnailUrl'))) {
        thumbs = { thumbnails: [{ url: comment.author.avatarThumbnailUrl, width: 88, height: 88 }] };
      }
      this.author = new Author({
        simpleText: comment.author?.displayName,
        navigationEndpoint: comment.avatar?.endpoint || comment.author?.channelCommand
      }, comment.author, thumbs, comment.author?.channelId);`;

  if (bundleUnpatchedPattern.test(content)) {
    content = content.replace(bundleUnpatchedPattern, bundleReplacement);
    content = content.replace(
      /this\.is_member = !!comment\.author\.sponsorBadgeUrl;\s*if \(Reflect\.has\(comment\.author, "sponsorBadgeUrl"\)\) \{/g,
      `this.is_member = !!comment.author?.sponsorBadgeUrl;\n      if (comment.author && Reflect.has(comment.author, "sponsorBadgeUrl")) {`
    );
    fs.writeFileSync(bundlePath, content, "utf8");
    console.log(`[patch-dependencies] Successfully patched bundle/${bundleName}`);
    patchedCount++;
  }
}

console.log(`[patch-dependencies] Finished applying patches (${patchedCount} file(s) updated).`);
