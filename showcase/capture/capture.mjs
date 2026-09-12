// Records the Gretel showcase footage.
//
// Shots run in order on one page. The wizard shot creates the profile and
// kicks off a real feed build; the build shot keeps recording that same build
// (so the progress UI is genuine and the OpenRouter embeddings really run),
// and every later shot reloads the now-warm feed.
//
// Footage lands in showcase/public/captures/<shot>/ as a jpeg sequence plus
// raw.json (frame timestamps). `node capture/normalize.mjs` turns those into
// constant-FPS frame sequences for Remotion.
//
// Usage:
//   node capture/capture.mjs                        # all shots
//   node capture/capture.mjs --only=01-wizard,02-build
//   node capture/capture.mjs --keep-data            # do not wipe profiles first

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ScreencastRecorder,
  clickAt,
  hoverCard,
  launchBrowser,
  moveMouse,
  newSceneContext,
  typeHuman,
  waitForImages,
  waitForStableFeed,
  waitForVisibleImages,
  writeRawManifest
} from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(HERE, "..");
const CAPTURE_DIR = path.join(SHOWCASE_DIR, "captures");
const BASE_URL = process.env.GRETEL_SHOWCASE_URL || "http://localhost:3111";
const VIEWPORT = { width: 1440, height: 900 };
/** How long the build shot keeps rolling before the edit cuts to the reveal. */
const MAX_BUILD_SECONDS = Number(process.env.SHOWCASE_MAX_BUILD_SECONDS || 110);

loadEnvFile(path.resolve(SHOWCASE_DIR, "..", ".env"));

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "").replace("--only=", "");
const keepData = args.includes("--keep-data");
const onlySet = only ? new Set(only.split(",").map((s) => s.trim())) : null;

const PROFILE = {
  name: "Creative Coding",
  tags: ["creative coding", "web design inspiration", "shaders and WebGL", "interaction design", "generative art"],
  channels: ["Fireship", "The Coding Train", "Codrops", "Bruno Simon"]
};

const log = (...parts) => console.log("[capture]", ...parts);

/** Minimal .env reader so the capture run can reuse the repo's OpenRouter key. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] || "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function api(pathname, init) {
  const response = await fetch(`${BASE_URL}${pathname}`, init);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function postJson(pathname, body) {
  return api(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function resetServerState() {
  const { profiles = [] } = await api("/api/profiles");
  for (const profile of profiles) {
    await postJson("/api/profiles", { action: "delete", profileId: profile.id });
  }
  // Pre-seed the key so the wizard's API-key step shows a saved key rather than
  // typing the real secret on camera. The wizard still runs for real.
  const key = process.env.OPENROUTER_API_KEY || "";
  await postJson("/api/settings", { openRouterApiKey: key, openRouterModel: "", developerAnalytics: true });
  log(`reset: removed ${profiles.length} profile(s), api key ${key ? "pre-seeded" : "MISSING"}`);
}

/** Boot the app and wait until the shell (or the first-run wizard) is on screen. */
async function gotoApp(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar, .profile-modal", { timeout: 60000 });
}

/** Boot the app and wait until feed cards with decoded thumbnails are visible. */
async function gotoFeed(page, { timeout = 300000 } = {}) {
  await gotoApp(page);
  await page.locator(".video-grid .video-card img").first().waitFor({ state: "attached", timeout });
  await waitForStableFeed(page, { timeout: 120000, quietMs: 500 });
  await waitForVisibleImages(page, { timeout: 90000 });
  await page.waitForTimeout(500);
}

const shots = [
  {
    name: "01-wizard",
    prepare: async (page) => {
      await gotoApp(page);
      await page.waitForSelector(".profile-modal", { timeout: 60000 });
      await page.waitForTimeout(1200);
    },
    run: async (page, recorder) => {
      const nameInput = page.locator('.profile-modal input[placeholder="e.g. Systems design"]');
      recorder.beat("name");
      await clickAt(page, nameInput);
      await typeHuman(page, PROFILE.name, { perChar: 55 });

      await clickAt(page, page.locator(".profile-modal .wizard-next"));
      await page.waitForTimeout(500);

      recorder.beat("topics");
      // Topics step: type each topic and commit with Enter.
      const topicInput = page.locator('.profile-modal input[placeholder="Add a topic"]');
      for (const tag of PROFILE.tags) {
        await clickAt(page, topicInput, { settle: 120 });
        await typeHuman(page, tag, { perChar: 26, settle: 140 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(220);
      }
      await page.waitForTimeout(500);
      await clickAt(page, page.locator(".profile-modal .wizard-next"));
      await page.waitForTimeout(500);

      recorder.beat("channels");
      // Channels step: live YouTube channel search.
      const channelInput = page.locator('.profile-modal input[placeholder="Search channel"]');
      for (const channel of PROFILE.channels) {
        await clickAt(page, channelInput, { settle: 120 });
        await typeHuman(page, channel, { perChar: 30, settle: 100 });
        const option = page.locator(".channel-results-popup .channel-popup-item").first();
        await option.waitFor({ state: "visible", timeout: 45000 });
        await page.waitForTimeout(700);
        await clickAt(page, option, { settle: 300 });
        await page.waitForTimeout(350);
      }
      await page.waitForTimeout(600);
      await clickAt(page, page.locator(".profile-modal .wizard-next"));
      await page.waitForTimeout(600);

      recorder.beat("key");
      // API key step. The key was pre-seeded via the settings API, so this
      // shows "API key already saved" instead of typing the real secret.
      const keyInput = page.locator('.profile-modal input[type="password"]');
      await clickAt(page, keyInput);
      await page.waitForTimeout(700);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);

      recorder.beat("submit");
      await clickAt(page, page.locator(".profile-modal .wizard-next"), { settle: 900 });
      await page.locator(".feed-build-container, .feed-build-compact").first().waitFor({
        state: "visible",
        timeout: 45000
      });
      recorder.beat("build-start");
      // Hold on the start of the build so 02-build continues seamlessly.
      await recorder.waitFor((r) => r.elapsed() > 5);
    }
  },
  {
    name: "02-build",
    // Continues the build started by the wizard shot: no navigation.
    prepare: async (page) => {
      await page.waitForFunction(
        () =>
          Boolean(document.querySelector(".feed-build-container")) ||
          document.querySelectorAll(".video-grid .video-card").length > 0,
        undefined,
        { timeout: 90000 }
      );
    },
    run: async (page, recorder) => {
      const firstCard = page.locator(".video-grid .video-card img").first();
      // Roll until the first cards appear, or until the edit's cut point.
      await Promise.race([
        firstCard.waitFor({ state: "attached", timeout: MAX_BUILD_SECONDS * 1000 }).then(() => recorder.beat("first-card")),
        recorder.waitFor((r) => r.elapsed() > MAX_BUILD_SECONDS, { timeout: MAX_BUILD_SECONDS * 1000 + 5000 })
      ]).catch(() => {});
      await page.waitForTimeout(400);
    },
    // Recording has stopped; let the remaining work settle so later shots load
    // a finished, persisted feed instead of kicking off another build.
    after: async (page) => {
      log("02-build: waiting for the build to finish (not recorded)");
      try {
        await page
          .locator(".video-grid .video-card img")
          .first()
          .waitFor({ state: "attached", timeout: 600000 });
        await waitForStableFeed(page, { timeout: 180000, quietMs: 700 });
        await waitForVisibleImages(page, { timeout: 60000 });
      } catch (error) {
        // Post-roll is a convenience, not a requirement: later shots reload the
        // feed and wait for it themselves.
        log(`02-build: post-roll timed out (${String(error.message).split("\n")[0]})`);
      }
      await page.waitForTimeout(1500);
      log("02-build: feed persisted");
    }
  },
  {
    name: "03-feed",
    prepare: (page) => gotoFeed(page),
    run: async (page, recorder) => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(600);
      recorder.beat("settled");

      const cards = page.locator(".video-grid .video-card");
      const first = cards.nth(0);
      const second = cards.nth(1);

      // Slow parallax scroll so the grid fills the frame.
      await page.mouse.move(720, 520);
      for (let step = 0; step < 18; step += 1) {
        await page.mouse.wheel(0, 40);
        await page.waitForTimeout(70);
      }
      await page.waitForTimeout(500);

      // One-tap quick actions: queue, then save a couple of cards. Each card is
      // brought back into view first so the pointer really lands on it.
      recorder.beat("hover-first");
      await hoverCard(page, first, { settle: 900 });
      await clickAt(page, first.locator(".card-quick-actions .quick-action").first(), { settle: 900, scroll: false });
      recorder.beat("queued");

      await hoverCard(page, second, { settle: 800 });
      await clickAt(page, second.locator(".card-quick-actions .quick-action").nth(1), { settle: 900, scroll: false });

      const third = cards.nth(2);
      await hoverCard(page, third, { settle: 700 });
      await clickAt(page, third.locator(".card-quick-actions .quick-action").nth(1), { settle: 800, scroll: false });
      recorder.beat("saved");

      for (const index of [3, 4]) {
        const card = cards.nth(index);
        await hoverCard(page, card, { settle: 600 });
        await clickAt(page, card.locator(".card-quick-actions .quick-action").first(), { settle: 700, scroll: false });
      }

      const counts = await page.evaluate(() => ({
        queued: document.querySelectorAll(".queue-topbar-count").length,
        saved: document.querySelectorAll(".quick-action.saved").length
      }));
      log(`03-feed: queued badge=${counts.queued}, saved buttons=${counts.saved}`);
      if (counts.saved === 0) throw new Error("no card ended up saved — quick actions missed");

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await page.waitForTimeout(1600);
      await waitForVisibleImages(page, { timeout: 30000 });
      await page.waitForTimeout(700);
    }
  },
  {
    name: "04-watch",
    prepare: (page) => gotoFeed(page),
    run: async (page, recorder) => {
      const first = page.locator(".video-grid .video-card").first();
      await hoverCard(page, first, { settle: 900 });
      await clickAt(page, first.locator(".thumbnail-button"), { settle: 1600, scroll: false });
      await page.locator(".watch-layout.open").waitFor({ state: "visible", timeout: 40000 });
      recorder.beat("opened");
      await page.waitForTimeout(2400);
      await waitForImages(page, { timeout: 60000 });

      // Scroll the watch column: metadata, then the up-next rail.
      await page.mouse.move(700, 620);
      for (let step = 0; step < 14; step += 1) {
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(1800);
      recorder.beat("scrolled");
      await waitForVisibleImages(page, { timeout: 30000 });
      await page.waitForTimeout(1400);
    }
  },
  {
    name: "05-queue",
    prepare: (page) => gotoFeed(page),
    run: async (page, recorder) => {
      await clickAt(page, page.locator(".queue-topbar-button"), { settle: 1600 });
      await page.locator(".queue-drawer").waitFor({ state: "visible", timeout: 30000 });
      recorder.beat("opened");
      await page.waitForTimeout(1400);
      await waitForVisibleImages(page, { timeout: 30000 });

      const items = page.locator(".queue-drawer .queue-item");
      if ((await items.count()) > 2) {
        await clickAt(page, items.nth(2).locator(".queue-drag-handle"), { settle: 250 });
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(800);
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(1000);
      }
      await moveMouse(page, 1150, 430, { steps: 20, settle: 1100 });
      await page.waitForTimeout(800);
    }
  },
  {
    name: "06-saved",
    prepare: (page) => gotoFeed(page),
    run: async (page, recorder) => {
      await clickAt(page, page.locator(".section-tabs button", { hasText: "Saved" }), { settle: 1800 });
      await page.locator(".saved-workspace").waitFor({ state: "visible", timeout: 40000 });
      recorder.beat("opened");
      await page.waitForTimeout(1500);
      await waitForVisibleImages(page, { timeout: 40000 });
      await page.waitForTimeout(800);

      const card = page.locator(".saved-card").first();
      if (await card.count()) {
        await clickAt(page, card.locator(".saved-card-more summary"), { settle: 600 });
        await clickAt(page, card.locator(".saved-card-more button", { hasText: "Organize" }), { settle: 1200 });
        const dialog = page.locator(".saved-dialog");
        if (await dialog.count()) {
          await dialog.waitFor({ state: "visible", timeout: 20000 });
          recorder.beat("organize");
          await page.waitForTimeout(900);
          await clickAt(page, dialog.locator('input[placeholder="New collection"]'), { settle: 250 });
          await typeHuman(page, "Watch later", { perChar: 60 });
          await clickAt(page, dialog.getByRole("button", { name: "Add" }), { settle: 1000 });
          const checkbox = dialog.locator('.saved-checklist input[type="checkbox"]').first();
          if (await checkbox.count()) await clickAt(page, checkbox, { settle: 800 });
          await clickAt(page, dialog.getByRole("button", { name: "Done" }), { settle: 1400 });
        }
      }

      await page.waitForTimeout(900);
      await waitForVisibleImages(page, { timeout: 40000 });

      await page.waitForTimeout(900);
      recorder.beat("filtered");
      const folder = page.locator(".saved-sidebar nav .saved-nav-row > button").first();
      if (await folder.count()) await clickAt(page, folder, { settle: 1400 });
      await page.waitForTimeout(1400);
      await waitForVisibleImages(page, { timeout: 40000 });
      await page.waitForTimeout(800);
    }
  }
];

/** Extra helpers the shots use on the recorder. */
function instrumentRecorder(recorder) {
  recorder.elapsed = () => Date.now() / 1000 - recorder.startedAt;
  recorder.waitFor = async (predicate, { timeout = 30000, interval = 100 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate(recorder)) return;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error("recorder.waitFor timed out");
  };
  return recorder;
}

async function main() {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  if (!keepData) await resetServerState();

  const browser = await launchBrowser();
  const context = await newSceneContext(browser, VIEWPORT);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") log("console error:", message.text().slice(0, 200));
  });

  const results = [];
  try {
    for (const shot of shots) {
      if (onlySet && !onlySet.has(shot.name)) continue;
      const outDir = path.join(CAPTURE_DIR, shot.name);
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(outDir, { recursive: true });

      log(`shot ${shot.name}: preparing`);
      await shot.prepare(page);

      const recorder = instrumentRecorder(new ScreencastRecorder(page));
      log(`shot ${shot.name}: recording`);
      const startedAt = Date.now();
      await recorder.start(outDir);
      try {
        await shot.run(page, recorder);
      } finally {
        await recorder.stop();
        writeRawManifest(outDir, recorder, VIEWPORT);
        const seconds = (Date.now() - startedAt) / 1000;
        results.push({ name: shot.name, frames: recorder.frames.length, seconds });
        log(`shot ${shot.name}: done (${recorder.frames.length} frames, ${seconds.toFixed(1)}s)`);
      }

      if (shot.after) {
        log(`shot ${shot.name}: post-roll`);
        await shot.after(page);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const summaryPath = path.join(CAPTURE_DIR, "index.json");
  let index = {};
  if (fs.existsSync(summaryPath)) {
    try {
      index = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    } catch {
      index = {};
    }
  }
  for (const shot of results) index[shot.name] = shot;
  fs.writeFileSync(summaryPath, JSON.stringify(index, null, 2));
  log("done", JSON.stringify(results));
}

main().catch((error) => {
  console.error("[capture] fatal:", error);
  process.exit(1);
});
