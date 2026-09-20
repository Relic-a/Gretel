import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relative) => readFileSync(join(root, relative), "utf8");

for (const file of [
  "app/page.tsx",
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
  "app/app/page.tsx",
  "app/app/layout.tsx",
  "app/diagnostics/layout.tsx",
  "app/gretel-app.tsx",
  "app/landing.css",
  "app/icon.tsx",
  "app/components/landing/SiteFooter.tsx",
  "public/landing/app-feed.webp"
]) {
  assert.ok(existsSync(join(root, file)), `${file} should exist`);
}

const landing = read("app/page.tsx");
const footer = read("app/components/landing/SiteFooter.tsx");
const rootLayout = read("app/layout.tsx");
const appRoute = read("app/app/page.tsx");
const appLayout = read("app/app/layout.tsx");
const diagnosticsLayout = read("app/diagnostics/layout.tsx");
const diagnosticsPage = read("app/diagnostics/page.tsx");
const launcher = read("src-tauri/src/lib.rs");
const privacy = read("app/privacy/page.tsx");
const terms = read("app/terms/page.tsx");
const nextConfig = read("next.config.mjs");

// The desktop app must keep booting into its own surface, never the marketing page.
assert.match(landing, /buildDownloadTargets/, "landing page should render platform downloads");
assert.match(landing, /id="install"/, "landing page needs an install section for the hero CTA");
assert.match(footer, /href="\/privacy"/);
assert.match(footer, /href="\/terms"/);
assert.doesNotMatch(landing, /^"use client"/m, "landing page should stay a server component");
assert.match(appRoute, /from "\.\.\/gretel-app"/, "the /app route should render the desktop UI");
assert.doesNotMatch(rootLayout, /WindowTitleBar/, "the title bar must not wrap marketing or legal pages");
assert.match(appLayout, /WindowTitleBar/);
assert.match(diagnosticsLayout, /WindowTitleBar/, "diagnostics shares the desktop title bar");
assert.doesNotMatch(diagnosticsPage, /href="\/"/, "diagnostics must not send users back to the marketing page");
assert.match(
  launcher,
  /\/app\?token=/,
  "the Tauri launcher must load the desktop app route, not the landing page"
);
assert.match(launcher, /http:\/\/127\.0\.0\.1:\{port\}\/app\?token=\{api_token\}/);
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
assert.equal(
  tauriConfig.build.devUrl,
  "http://127.0.0.1:3000/app",
  "the Tauri development window must load the desktop app route"
);

// Google requires a privacy policy that is accurate about the little data Gretel holds.
assert.match(privacy, /Google API Services User Data Policy/);
assert.match(privacy, /Supabase/);
assert.match(privacy, /local-first/i);
assert.match(terms, /Public beta/i);
assert.match(nextConfig, /X-Frame-Options/);
assert.match(nextConfig, /frame-ancestors 'none'/);

console.log("landing site structure tests passed");
