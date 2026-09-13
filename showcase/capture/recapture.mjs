// Fresh lossless, 2x capture. Uses a COPY of the demo profile, never resets data.
import fs from "node:fs";
import path from "node:path";
import { ScreencastRecorder, launchBrowser, newSceneContext, clickAt, moveMouse,
  typeHuman, waitForVisibleImages, writeRawManifest } from "./lib.mjs";

const root = process.env.SHOWCASE_CAPTURE_DIR;
if (!root) throw new Error("Set SHOWCASE_CAPTURE_DIR to a new capture directory");
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
const only = process.env.SHOWCASE_ONLY_SHOTS?.split(",");
const record = async (name, action) => {
  if (only && !only.includes(name)) { await action(); return; }
  const dir = path.join(root, name);
  if (fs.existsSync(path.join(dir, "raw.json"))) throw new Error("Capture already exists: " + dir);
  const recorder = new ScreencastRecorder(page);
  await page.evaluate(() => document.fonts.ready);
  await recorder.start(dir);
  await page.evaluate(() => {
    window.__tourPointer = [{ ...window.__tourLastPointer, t: Date.now() / 1000, click: false }];
  });
  try {
    await page.waitForTimeout(180);
    await action();
    await page.waitForTimeout(600);
  } finally {
    await recorder.stop();
    writeRawManifest(dir, recorder, { width: 2880, height: 1800 });
    const pointer = await page.evaluate(() => window.__tourPointer);
    const t0 = recorder.frames[0]?.timestamp || recorder.startedAt;
    fs.writeFileSync(path.join(dir, "pointer.json"), JSON.stringify(pointer.map(point => ({ ...point, t: Math.max(0, point.t - t0) }))));
    console.log(name, recorder.frames.length, (recorder.stoppedAt - recorder.startedAt).toFixed(2));
  }
};
const click = (locator, settle = 160) => clickAt(page, locator, { settle });
const feed = async () => {
  await page.goto(base);
  await page.locator(".video-grid .video-card").first().waitFor({ timeout: 60000 });
  await waitForVisibleImages(page);
  await page.waitForTimeout(500);
};
try {
  await feed();
  await click(page.locator(".profile-button"));
  await click(page.getByRole("button", { name: "Manage profiles" }));
  await record("v2-name", async () => {
    await click(page.locator('.profile-modal input[placeholder="e.g. Systems design"]'));
    await typeHuman(page, "Creative Coding", { perChar: 32, jitter: 0, settle: 250 });
    await page.waitForTimeout(700);
  });
  await click(page.locator(".profile-modal .wizard-next"));
  await record("v2-topics", async () => {
    const input = page.locator('input[placeholder="Add a topic"]');
    for (const topic of ["web design", "generative art", "WebGL"]) {
      await click(input, 30);
      await typeHuman(page, topic, { perChar: 18, jitter: 0, settle: 30 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(100);
    }
  });
  await click(page.locator(".profile-modal .wizard-next"));
  await record("v2-channels", async () => {
    await click(page.locator('input[placeholder="Search channel"]'));
    await typeHuman(page, "The Coding Train", { perChar: 22, jitter: 0, settle: 100 });
    const option = page.locator(".channel-popup-item").first();
    await option.waitFor({ state: "visible", timeout: 45000 });
    await click(option, 300);
    await page.waitForTimeout(900);
  });
  await click(page.locator(".profile-modal").getByRole("button", { name: "Close", exact: true }));
  await feed();
  await record("v2-feed", async () => {
    await moveMouse(page, 1380, 860);
    await page.mouse.wheel(0, 520);
    await page.waitForTimeout(350);
    await page.mouse.wheel(0, -520);
    await page.waitForTimeout(350);
    const cards = page.locator(".video-card");
    const save = cards.nth(0).locator(".quick-action").nth(1);
    await moveMouse(page, 340, 430);
    await page.waitForTimeout(180);
    if (!(await save.getAttribute("class"))?.includes("saved")) await click(save, 250);
    await moveMouse(page, 1040, 430);
    await page.waitForTimeout(180);
    const queue = cards.nth(1).locator(".quick-action").first();
    if (!(await queue.getAttribute("class"))?.includes("queued")) await click(queue, 300);
  });
  // Ensure the player has loaded before the watch shot. The click is captured;
  // trim any network wait using the named ready beat when assembling the edit.
  await record("v2-watch", async () => {
    await click(page.locator(".video-card").first().locator(".thumbnail-button"), 600);
    await page.locator(".watch-layout.open").waitFor({ timeout: 40000 });
    await page.waitForTimeout(2500);
    await moveMouse(page, 1500, 1320);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(700);
  });
  await feed();
  await record("v2-queue", async () => {
    await click(page.locator(".queue-topbar-button"), 300);
    const handle = page.locator(".queue-drawer .queue-drag-handle").nth(1);
    await click(handle, 120);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(600);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(500);
  });
  await feed();
  await record("v2-saved", async () => {
    await click(page.locator(".section-tabs button").filter({ hasText: "Saved" }), 300);
    const card = page.locator(".saved-card").first();
    await card.waitFor({ timeout: 10000 });
    await click(card.locator(".saved-card-more summary"), 120);
    await click(card.getByRole("button", { name: "Organize", exact: true }), 160);
    const dialog = page.locator(".saved-dialog");
    const collection = dialog.locator('.saved-checklist input[type="checkbox"]').first();
    await click(collection, 150);
    await click(dialog.getByRole("button", { name: "Done", exact: true }), 300);
    await click(page.locator(".saved-sidebar nav .saved-nav-row > button").first(), 350);
  });
} finally {
  await browser.close();
}
