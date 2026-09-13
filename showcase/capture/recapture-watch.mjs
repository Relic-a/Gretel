// Watch-only capture for the README showcase.
//
// The render server's datacenter IP is refused embedded playback (YouTube error
// 150), so the browser egresses through a supplied proxy for this one shot. The
// recorder picks a card that is known to embed, pre-warms the player (cold start
// is ~8s; warm is ~2s), then records and asserts the player genuinely advances.
// A failed, blocked, or loading-only player is never kept.
import fs from "node:fs";
import path from "node:path";
import { ScreencastRecorder, launchBrowser, newSceneContext, clickAt, moveMouse,
  waitForVisibleImages, writeRawManifest } from "./lib.mjs";

const root = process.env.SHOWCASE_CAPTURE_DIR;
if (!root) throw new Error("Set SHOWCASE_CAPTURE_DIR to a new capture directory");
const targetSeconds = Number(process.env.WATCH_SECONDS || "7.0");
// Candidates verified to permit embedding through the egress, ordered so the
// most visually active clips come first (a near-static promo makes the player
// look frozen). The feed order is randomized per load, so we reload until one
// of these is actually present.
const preferred = (process.env.WATCH_IDS || "55iwMYv8tGI,f4s1h2YETNY,eBV14-3LT-g,4JzDttgdILQ,MJNy2mdCt20")
  .split(",").map((s) => s.trim()).filter(Boolean);
const keywords = (process.env.WATCH_KEYWORDS || "creative coding,shader,generative art,bruno imbrizi,pbs,ascii")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
fs.mkdirSync(root, { recursive: true });

const browser = await launchBrowser();
// CDP screencast ignores DPR. Render a 2x viewport at 200% browser content zoom
// so the captured PNG itself contains 2880x1800 freshly rasterized pixels.
const context = await newSceneContext(browser, { width: 2880, height: 1800, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  window.__tourPointer = [];
  window.__tourLastPointer = { x: 1440, y: 900 };
  const track = (event, click = false) => {
    window.__tourLastPointer = { x: event.clientX, y: event.clientY };
    window.__tourPointer.push({ ...window.__tourLastPointer, t: Date.now() / 1000, click });
  };
  window.addEventListener("mousemove", event => track(event), { passive: true });
  window.addEventListener("mousedown", event => track(event, true), { passive: true });
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.style.zoom = "2";
    const style = document.createElement("style");
    style.textContent = "#__showcase-cursor, #__showcase-click-ring { visibility: hidden !important; }";
    document.head.appendChild(style);
  }, { once: true });
});
const page = await context.newPage();
const base = process.env.GRETEL_SHOWCASE_URL || "http://127.0.0.1:3111";
const playerErrors = [];
page.on("console", (message) => {
  if (/player error/i.test(message.text())) playerErrors.push(message.text().slice(0, 200));
});

const dir = path.join(root, "v2-watch");
if (fs.existsSync(path.join(dir, "raw.json"))) throw new Error("Capture already exists: " + dir);

const feedReady = async () => {
  await page.locator(".video-grid .video-card").first().waitFor({ timeout: 60000 });
  await waitForVisibleImages(page);
};

async function listCards() {
  return page.locator(".video-grid .video-card").evaluateAll((nodes) =>
    nodes.map((n, i) => {
      const src = n.querySelector("img")?.getAttribute("src") || "";
      const match = src.match(/\/api\/thumbnails\/([A-Za-z0-9_-]+)/) || src.match(/\/vi\/([A-Za-z0-9_-]+)\//);
      return {
        i,
        id: match ? match[1] : "",
        title: n.querySelector(".video-title-row h2")?.textContent?.trim() || ""
      };
    })
  ).then((cards) => cards.filter((card) => card.id && !card.id.startsWith("PL")));
}

async function pickCard() {
  // The feed order is randomized per load. Plain title keywords can land on a
  // near-static promo, so prefer ids that are known to permit embedding here and
  // reload the feed until one is actually present.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const cards = await listCards();
    const byPreferred = preferred.map((id) => cards.find((card) => card.id === id)).find(Boolean);
    if (byPreferred) return byPreferred;
    await page.reload();
    await feedReady();
  }
  const cards = await listCards();
  const scored = cards
    .map((card) => ({ ...card, score: keywords.reduce((sum, word) => sum + (card.title.toLowerCase().includes(word) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score === 0) throw new Error("No suitable feed card found");
  return scored[0];
}

// The YT iframe can be recreated while a previous one is still tearing down, so
// prefer the frame that actually matches the video we opened.
const playerFrame = (expectId) => {
  const frames = page.frames().filter(frame => /youtube\.com\/embed\//.test(frame.url()));
  if (expectId) {
    const match = frames.find(frame => frame.url().includes(expectId));
    if (match) return match;
  }
  return frames[frames.length - 1];
};
const readPlayback = async (expectId) => {
  const frame = playerFrame(expectId);
  if (!frame) return { present: false };
  try {
    return await frame.evaluate(() => {
      const video = document.querySelector("video");
      return {
        present: true,
        src: location.href,
        time: video ? video.currentTime : -1,
        paused: video ? video.paused : null,
        readyState: video ? video.readyState : -1,
        errorShown: Boolean(document.querySelector(".ytp-error"))
      };
    });
  } catch (caught) {
    return { present: true, error: String(caught).slice(0, 120) };
  }
};

const openCard = async (card) => {
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await clickAt(page, card.locator(".thumbnail-button"), { settle: 400 });
  await page.locator(".watch-layout.open").waitFor({ timeout: 40000 });
};
const backToFeed = async () => {
  await page.locator(".brand-button").click();
  await feedReady();
  await page.waitForTimeout(800);
};
// Watch until the player is genuinely producing frames, or give up.
const waitForPlaying = async (limitMs, expectId) => {
  const deadline = Date.now() + limitMs;
  let last = null;
  while (Date.now() < deadline) {
    const now = await readPlayback(expectId);
    last = now;
    if (now.present && now.errorShown) throw new Error("Embedded player showed an error");
    if (now.present && !now.paused && now.readyState >= 2 && now.time > 0.3) return now;
    await page.waitForTimeout(400);
  }
  return last;
};

await page.goto(base);
await feedReady();
const chosen = await pickCard();
console.log("[watch] card", chosen.id, "|", chosen.title);

// Warm the player and the CDN cache outside the recording: open, play briefly,
// return to the feed. The recorded open then starts in about two seconds.
await openCard(page.locator(".video-grid .video-card").nth(chosen.i));
const warm = await waitForPlaying(45000, chosen.id);
if (!warm?.present || warm.time <= 0.3) throw new Error("Warm-up playback failed");
console.log("[watch] warm at", warm.time.toFixed(2), "s");
await backToFeed();

// Re-locate the card by id: going back may reorder the grid.
const recordedCardIndex = (await listCards()).find((card) => card.id === chosen.id)?.i;
if (recordedCardIndex === undefined) throw new Error("Card vanished after warm-up: " + chosen.id);
const card = page.locator(".video-grid .video-card").nth(recordedCardIndex);
const recorder = new ScreencastRecorder(page);
await page.evaluate(() => document.fonts.ready);
await recorder.start(dir);
await page.evaluate(() => {
  window.__tourPointer = [{ ...window.__tourLastPointer, t: Date.now() / 1000, click: false }];
});

let verified = null;
let lastSeen = null;
try {
  await page.waitForTimeout(180);
  await openCard(card);

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const now = await readPlayback(chosen.id);
    lastSeen = now;
    if (now.present && now.errorShown) throw new Error("Embedded player showed an error");
    if (now.present && !now.paused && now.readyState >= 2 && now.time > 0.3) {
      const before = now.time;
      await page.waitForTimeout(1400);
      const after = await readPlayback(chosen.id);
      if (after.present && after.time > before + 0.4 && !after.errorShown) {
        verified = { ...after, advancedBy: after.time - before };
        break;
      }
    }
    await page.waitForTimeout(400);
  }
  if (!verified) {
    console.log("[watch] last player state:", JSON.stringify(lastSeen));
    throw new Error("Embedded playback did not advance; refusing to keep footage");
  }
  if (!verified.src.includes(chosen.id)) {
    throw new Error(`Opened ${verified.src.slice(0, 90)} but expected ${chosen.id}`);
  }
  console.log("[watch] verified playback", JSON.stringify({ time: verified.time, advancedBy: verified.advancedBy }));

  // Play real frames for the rest of the scene, then rest the pointer low so the
  // narration's "next videos are on the right" beat reads. No cursor slowdown.
  const remaining = targetSeconds * 1000 - recorder.elapsed() * 1000;
  if (remaining > 0) await page.waitForTimeout(remaining);
  await moveMouse(page, 1500, 1320);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(650);
} finally {
  await recorder.stop();
  writeRawManifest(dir, recorder, { width: 2880, height: 1800 });
  const pointer = await page.evaluate(() => window.__tourPointer);
  const t0 = recorder.frames[0]?.timestamp || recorder.startedAt;
  fs.writeFileSync(path.join(dir, "pointer.json"),
    JSON.stringify(pointer.map(point => ({ ...point, t: Math.max(0, point.t - t0) }))));
  console.log("v2-watch", recorder.frames.length, (recorder.stoppedAt - recorder.startedAt).toFixed(2));
  if (playerErrors.length) console.log("player errors:", playerErrors.join(" | "));
  await browser.close();
}
if (!verified) process.exit(1);
