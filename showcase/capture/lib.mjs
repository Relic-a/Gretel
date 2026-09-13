// Shared capture utilities for the Gretel showcase.
//
// Instead of Playwright's built-in video recording we drive Chrome DevTools
// Protocol `Page.startScreencast`, which hands back every frame with a
// wall-clock timestamp. That gives a deterministic, exactly-timed image
// sequence we can replay in Remotion at a fixed frame rate without guessing
// where a webm starts or ends.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

export const FPS = 30;

/** Injected cursor so the recording shows a pointer and click ripples. */
const CURSOR_SCRIPT = `
(() => {
  if (window.__gretelShowcaseCursor) return;
  window.__gretelShowcaseCursor = true;

  const mount = () => {
    if (document.getElementById("__showcase-cursor")) return;
    const el = document.createElement("div");
    el.id = "__showcase-cursor";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = [
      "position:fixed", "left:0", "top:0", "width:22px", "height:22px",
      "z-index:2147483647", "pointer-events:none", "transform:translate3d(-100px,-100px,0)",
      "will-change:transform"
    ].join(";");
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none">' +
      '<path d="M4 2.6 17.2 11.1l-5.6 1.1-2.7 5.2z" fill="#ffffff" stroke="#0a0a0c" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg>';
    document.documentElement.appendChild(el);

    const ring = document.createElement("div");
    ring.id = "__showcase-click-ring";
    ring.setAttribute("aria-hidden", "true");
    ring.style.cssText = [
      "position:fixed", "left:0", "top:0", "width:14px", "height:14px", "border-radius:50%",
      "border:2px solid #ff5242", "background:rgba(255,82,66,0.25)", "opacity:0",
      "z-index:2147483646", "pointer-events:none", "transform:translate3d(-100px,-100px,0)"
    ].join(";");
    document.documentElement.appendChild(ring);

    window.addEventListener("mousemove", (event) => {
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      el.style.transform = "translate3d(" + (event.clientX / zoom - 3) + "px," + (event.clientY / zoom - 3) + "px,0)";
    }, { passive: true });

    window.addEventListener("mousedown", (event) => {
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      ring.style.transform = "translate3d(" + (event.clientX / zoom - 7) + "px," + (event.clientY / zoom - 7) + "px,0)";
      ring.style.transition = "none";
      ring.style.opacity = "0.9";
      ring.style.width = "14px";
      ring.style.height = "14px";
      requestAnimationFrame(() => {
        ring.style.transition = "opacity 520ms ease-out, width 320ms ease-out, height 320ms ease-out";
        ring.style.width = "46px";
        ring.style.height = "46px";
        ring.style.opacity = "0";
      });
    }, { passive: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
`;

export class ScreencastRecorder {
  constructor(page) {
    this.page = page;
    this.cdp = null;
    this.frames = [];
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.active = false;
    this.writeChain = Promise.resolve();
    this.outDir = "";
    /** Named wall-clock marks so the edit can cut on real moments. */
    this.beats = [];
  }

  /** Records a named moment (seconds since the scene started). */
  beat(name) {
    if (!this.active) return;
    const at = nowSeconds() - this.startedAt;
    this.beats.push({ name, at });
    console.log(`[capture] beat ${name} @ ${at.toFixed(2)}s`);
  }

  /** Seconds elapsed since the scene started recording. */
  elapsed() {
    return this.active || this.startedAt ? nowSeconds() - this.startedAt : 0;
  }

  async start(outDir) {
    if (this.active) throw new Error("screencast already running");
    this.outDir = outDir;
    fs.mkdirSync(outDir, { recursive: true });
    this.frames = [];
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", (event) => {
      const index = this.frames.length;
      this.frames.push({ index, timestamp: event.metadata.timestamp });
      const file = path.join(outDir, `${String(index).padStart(5, "0")}.png`);
      this.writeChain = this.writeChain.then(
        () => fs.promises.writeFile(file, Buffer.from(event.data, "base64")).catch(() => {})
      );
      this.cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", {
      format: "png",
      maxWidth: 2880,
      maxHeight: 1800,
      everyNthFrame: 1
    });
    this.startedAt = nowSeconds();
    this.active = true;
    return this;
  }

  async stop() {
    if (!this.active) return this;
    this.active = false;
    this.stoppedAt = nowSeconds();
    try {
      await this.cdp.send("Page.stopScreencast");
    } catch {}
    await this.writeChain;
    if (this.frames.length > 0) {
      // The last emitted frame covers the stretch until the screencast stopped.
      this.frames[this.frames.length - 1].holdUntil = this.stoppedAt;
    }
    return this;
  }
}

function nowSeconds() {
  return Date.now() / 1000;
}

export function readFramesManifest(outDir) {
  const entries = fs
    .readdirSync(outDir)
    .filter((name) => name.endsWith(".jpg"))
    .sort();
  return entries;
}

/** Frame size the screencast was configured with. */
function rawSize(raw) {
  return { width: raw.width, height: raw.height };
}

/**
 * Turn timestamped frames into a constant-FPS sequence, holding each frame for
 * as long as it was on screen. Writes `frames.json` describing the sequence.
 */
export function normalizeFrames(outDir, { fps = FPS } = {}) {
  const raw = JSON.parse(fs.readFileSync(path.join(outDir, "raw.json"), "utf8"));
  const entries = raw.frames;
  if (entries.length === 0) throw new Error(`no frames in ${outDir}`);

  const t0 = entries[0].timestamp;
  const tEnd = entries[entries.length - 1].holdUntil ?? entries[entries.length - 1].timestamp;
  const duration = Math.max(tEnd - t0, 1 / fps);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const sequence = [];
  let cursor = 0;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const t = frame / fps;
    while (
      cursor + 1 < entries.length &&
      entries[cursor + 1].timestamp - t0 <= t + 1 / (fps * 2)
    ) {
      cursor += 1;
    }
    sequence.push(entries[cursor].index);
  }

  const manifest = {
    dir: path.basename(outDir),
    fps,
    frameCount: totalFrames,
    durationSeconds: duration,
    width: raw.width,
    height: raw.height,
    sequence
  };
  fs.writeFileSync(path.join(outDir, "frames.json"), JSON.stringify(manifest));
  return manifest;
}

export async function launchBrowser() {
  const args = [
    "--hide-scrollbars",
    "--disable-features=CalculateNativeWinOcclusion",
    "--font-render-hinting=medium",
    // A 2880x1800 viewport with a live YouTube embed is memory-hungry. Keep
    // the renderer lean so a laptop capture does not hit its memory ceiling.
    "--disable-dev-shm-usage",
    "--js-flags=--max-old-space-size=512",
    // The watch shot relies on the embedded player starting on its own. Server
    // Chrome applies a stricter autoplay policy than a desktop browser.
    "--autoplay-policy=no-user-gesture-required"
  ];
  // Datacenter IPs are refused embedded playback (YouTube error 150). When a
  // SOCKS/HTTP egress is supplied, route the browser through it so the capture
  // can still happen on the render server.
  if (process.env.SHOWCASE_PROXY) {
    // Chrome already bypasses loopback, so the local app stays direct while
    // YouTube egresses through the supplied proxy.
    args.push(`--proxy-server=${process.env.SHOWCASE_PROXY}`);
  }
  return chromium.launch({
    executablePath: process.env.SHOWCASE_BROWSER || undefined,
    args
  });
}

export async function newSceneContext(browser, { width = 1440, height = 900, deviceScaleFactor = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    colorScheme: "dark",
    reducedMotion: "no-preference"
  });
  await context.addInitScript(CURSOR_SCRIPT);
  return context;
}

export async function moveMouse(page, x, y, { settle = 30 } = {}) {
  // Bounded motion time instead of dozens of serial protocol round trips.
  const from = page.__showcasePointer || { x: 720, y: 450 };
  const start = Date.now();
  const duration = 180;
  while (Date.now() - start < duration) {
    const t = Math.min(1, (Date.now() - start) / duration);
    const eased = t * t * (3 - 2 * t);
    await page.mouse.move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased);
    await page.waitForTimeout(12);
  }
  await page.mouse.move(x, y);
  page.__showcasePointer = { x, y };
  await page.waitForTimeout(settle);
}

export async function clickAt(page, locator, { settle = 260, steps = 16, scroll = true } = {}) {
  const target = locator.first();
  if (scroll) {
    // Cards can drift under the fold; bring the target back into view first so
    // the recorded pointer lands on the element instead of empty space.
    await target.scrollIntoViewIfNeeded().catch(() => {});
  }
  const box = await target.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (y < 0 || y > page.viewportSize().height) throw new Error(`element is off-screen (y=${Math.round(y)})`);
  await moveMouse(page, x, y, { steps });
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  await page.waitForTimeout(settle);
}

/** Moves the pointer over a card and waits for its quick actions to appear. */
export async function hoverCard(page, card, { settle = 800 } = {}) {
  await card.scrollIntoViewIfNeeded().catch(() => {});
  const box = await card.boundingBox();
  if (!box) throw new Error("card has no bounding box");
  const x = box.x + box.width * 0.5;
  const y = box.y + Math.min(box.height * 0.3, 140);
  await moveMouse(page, x, y, { steps: 24, settle });
  await card.locator(".card-quick-actions").first().waitFor({ state: "visible", timeout: 5000 });
  return { x, y };
}

export async function typeHuman(page, text, { perChar = 42, jitter = 26, settle = 180 } = {}) {
  for (const char of text) {
    await page.keyboard.type(char);
    await page.waitForTimeout(perChar + Math.random() * jitter);
  }
  await page.waitForTimeout(settle);
}

/** Wait until every <img> in the viewport has decoded (loaded or errored). */
export async function waitForImages(page, { timeout = 45000, selector = "img" } = {}) {
  await page.waitForFunction(
    (sel) => {
      const images = Array.from(document.querySelectorAll(sel));
      return images.every((img) => img.complete);
    },
    selector,
    { timeout }
  );
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      images.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()))
    );
  });
}

/**
 * Wait until every image near the viewport has finished loading.
 *
 * Video thumbnails must have real pixels (naturalWidth > 0), because a card
 * with a blank thumbnail is exactly the failure mode this guards against.
 * Avatars only need to have settled: Gretel renders an initial-letter
 * placeholder when a channel avatar is unavailable, so they may legitimately
 * never produce pixels.
 */
export async function waitForVisibleImages(page, { timeout = 45000, settleMs = 350 } = {}) {
  await page.waitForFunction(
    () => {
      const images = Array.from(document.querySelectorAll("img"));
      const near = images.filter(
        (img) => img.getBoundingClientRect().top < window.innerHeight + 240
      );
      return near.every((img) => {
        if (!img.complete) return false;
        const isThumbnail = Boolean(img.closest(".thumbnail-wrap"));
        return isThumbnail ? img.naturalWidth > 0 : true;
      });
    },
    undefined,
    { timeout }
  );
  await page.waitForTimeout(settleMs);
}

export async function waitForStableFeed(page, { timeout = 60000, quietMs = 450 } = {}) {
  const deadline = Date.now() + timeout;
  let lastSignature = "";
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    const signature = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".video-grid .video-card"));
      return [
        cards.length,
        cards
          .map((card) => {
            const img = card.querySelector("img");
            return img && img.complete && img.naturalWidth > 0 ? "1" : "0";
          })
          .join("")
      ].join("|");
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs && /^[1-9]/.test(signature)) {
      return;
    }
    await page.waitForTimeout(100);
  }
}

export function writeRawManifest(outDir, recorder, viewport) {
  fs.writeFileSync(
    path.join(outDir, "raw.json"),
    JSON.stringify(
      {
        width: viewport.width,
        height: viewport.height,
        startedAt: recorder.startedAt,
        stoppedAt: recorder.stoppedAt,
        beats: recorder.beats,
        frames: recorder.frames
      },
      null,
      2
    )
  );
}
