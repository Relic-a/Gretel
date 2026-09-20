import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Bookmark,
  Compass,
  Download,
  HardDrive,
  Layers,
  ListOrdered,
  MonitorPlay,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";

import packageJson from "../package.json";
import { canonical } from "./site";
import { SiteFooter } from "./components/landing/SiteFooter";
import { SiteHeader } from "./components/landing/SiteHeader";
import { GithubMark } from "./components/landing/brand-marks";
import {
  ISSUES_URL,
  LATEST_RELEASE_URL,
  RELEASES_URL,
  buildDownloadTargets
} from "./components/landing/landing-data";

export const metadata: Metadata = {
  title: "Gretel · A YouTube feed you actually chose",
  description:
    "Gretel is a local-first desktop app that builds focused YouTube feeds around your own topics and channels. Profiles, history, and saved videos stay on your computer.",
  alternates: canonical("/")
};

const downloadTargets = buildDownloadTargets(packageJson.version);

const facts = [
  {
    icon: HardDrive,
    title: "Stored on your computer",
    detail: "Profiles, history, likes, and saved videos live in a local SQLite database."
  },
  {
    icon: ShieldCheck,
    title: "No extra Google account",
    detail: "Gretel never asks for your password or access to your YouTube account."
  },
  {
    icon: Download,
    title: `${downloadTargets.length} package formats`,
    detail: "Windows, macOS, AppImage, .deb, .rpm, and an Arch package from the same release."
  },
  {
    icon: SlidersHorizontal,
    title: "Managed or your own key",
    detail: "Sign in for a managed allowance, redeem an invite, or use your own OpenRouter key."
  }
];

const steps = [
  {
    icon: Compass,
    title: "Name the interest",
    detail:
      "Create a profile and add a few topics and channels. Each profile keeps its own feed, saved videos, and history."
  },
  {
    icon: Layers,
    title: "Gretel gathers candidates",
    detail:
      "Gretel searches YouTube directly, then ranks the results with embeddings so expansion stays relevant to that profile."
  },
  {
    icon: Bookmark,
    title: "Watch, keep, refine",
    detail:
      "Likes, saves, skips, and watch history nudge what comes next. Everything is recorded locally, on this computer."
  }
];

const tools = {
  local: {
    icon: HardDrive,
    title: "Local-first by default",
    detail:
      "Profiles, subscriptions, saved videos, likes, watch history, cached thumbnails, and logs stay in Gretel's app-data folder on your device."
  },
  embedding: {
    icon: SlidersHorizontal,
    title: "Embeddings on your terms",
    detail:
      "Use the managed allowance after Google sign-in or an access code, or point Gretel at your own OpenRouter key."
  },
  queue: {
    icon: ListOrdered,
    title: "Playlists become queues",
    detail: "Queue a playlist in order, reorder what is next, and let playback follow the queue."
  },
  collections: {
    icon: Layers,
    title: "Collections, not a junk drawer",
    detail: "Group saved videos into folders, tag them, and leave a note about why they mattered."
  },
  youtube: {
    icon: MonitorPlay,
    title: "Straight from YouTube",
    detail:
      "Search, metadata, thumbnails, and playback come from YouTube's own services. Gretel is not an alternative host."
  }
};

export default function LandingPage() {
  return (
    <div className="landing">
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">Public beta for desktop</p>
              <h1>
                Describe the feed.
                <br />
                Gretel curates it.
              </h1>
              <p className="hero-sub">
                Build a focused YouTube feed around your interests, with profiles, topics, and channels
                that stay on your computer.
              </p>
              <div className="hero-actions">
                <a className="button primary" href="#install">
                  <Download size={18} aria-hidden="true" />
                  Download Gretel
                </a>
                <a className="button ghost" href={RELEASES_URL} rel="noreferrer">
                  <GithubMark size={16} />
                  View releases
                </a>
              </div>
            </div>

            <div className="hero-visual">
              <div className="app-frame">
                <div className="app-frame-bar" aria-hidden="true">
                  <span /><span /><span />
                  <em>Gretel</em>
                </div>
                <Image
                  className="app-frame-image"
                  src="/landing/app-feed.webp"
                  alt="The Gretel desktop app showing a ranked feed of YouTube video cards with a profile selector and topic filters."
                  width={1600}
                  height={1067}
                  loading="eager"
                  fetchPriority="high"
                  sizes="(max-width: 900px) 100vw, 620px"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="fact-strip" aria-label="Highlights">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div className="fact" key={fact.title}>
                <Icon size={20} aria-hidden="true" />
                <div>
                  <strong>{fact.title}</strong>
                  <p>{fact.detail}</p>
                </div>
              </div>
            );
          })}
        </section>

        <section className="section" id="how-it-works">
          <div className="section-head">
            <h2>How it works</h2>
            <p>Three steps from an empty install to a feed that reflects what you asked for.</p>
          </div>

          <ol className="steps">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <li className="step" key={step.title}>
                  <span className="step-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <Icon className="step-icon" size={22} aria-hidden="true" />
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="section" id="features">
          <div className="section-head">
            <h2>What is inside</h2>
            <p>Small, deliberate tools for keeping a feed useful without handing over your watch history.</p>
          </div>

          <div className="bento">
            <article className="bento-cell bento-wide">
              <tools.local.icon size={22} aria-hidden="true" />
              <h3>{tools.local.title}</h3>
              <p>{tools.local.detail}</p>
            </article>
            <article className="bento-cell">
              <tools.embedding.icon size={22} aria-hidden="true" />
              <h3>{tools.embedding.title}</h3>
              <p>{tools.embedding.detail}</p>
            </article>
            <article className="bento-cell">
              <tools.queue.icon size={22} aria-hidden="true" />
              <h3>{tools.queue.title}</h3>
              <p>{tools.queue.detail}</p>
            </article>
            <article className="bento-cell">
              <tools.collections.icon size={22} aria-hidden="true" />
              <h3>{tools.collections.title}</h3>
              <p>{tools.collections.detail}</p>
            </article>
            <article className="bento-cell bento-wide">
              <tools.youtube.icon size={22} aria-hidden="true" />
              <h3>{tools.youtube.title}</h3>
              <p>{tools.youtube.detail}</p>
            </article>
          </div>
        </section>

        <section className="section" id="install">
          <div className="section-head">
            <h2>Install the beta</h2>
            <p>
              Version {packageJson.version} is the current build. Pick your platform and the download
              starts right here, or open the full release for checksums and older builds.
            </p>
          </div>

          <div className="download-grid">
            {downloadTargets.map((target) => (
              <article className="download-card" key={target.id}>
                <div>
                  <h3>{target.label}</h3>
                  <p>{target.detail}</p>
                </div>
                <code>{target.fileName}</code>
                <a
                  className="button primary block"
                  href={target.url}
                  rel="noreferrer"
                  aria-label={`Download Gretel for ${target.label}`}
                >
                  <Download size={17} aria-hidden="true" />
                  Download
                </a>
              </article>
            ))}
          </div>

          <aside className="install-note" role="note">
            <p>
              These installers are unsigned, so Windows SmartScreen or macOS Gatekeeper may warn you
              about an unidentified developer. Windows, macOS, AppImage, .deb, and .rpm builds update
              themselves in-app; the Arch package receives newer versions through <code>pacman</code>.
            </p>
            <p>
              Prefer to see everything first?{" "}
              <a href={RELEASES_URL} rel="noreferrer">Browse all releases</a> or{" "}
              <a href={LATEST_RELEASE_URL} rel="noreferrer">open the latest release page</a>.
            </p>
          </aside>
        </section>

        <section className="section" id="requirements">
          <div className="section-head">
            <h2>Requirements and local builds</h2>
            <p>For most people the installers above are enough. Building from source needs a small toolchain.</p>
          </div>

          <div className="requirements">
            <div className="requirements-copy">
              <h3>Running the desktop app</h3>
              <ul className="check-list">
                <li>Windows 10 or 11 (64-bit), macOS on Apple silicon, or a recent Linux distribution.</li>
                <li>No Node.js, Rust, or account is required for an installed build.</li>
                <li>An internet connection, since search and playback use YouTube directly.</li>
                <li>An OpenRouter key only if you choose the bring-your-own-key mode instead of managed access.</li>
              </ul>
            </div>

            <div className="requirements-code">
              <h3>Building from source</h3>
              <pre>
                <code>{`git clone https://github.com/Relic-a/Gretel.git
cd Gretel
npm install
npm run tauri:dev`}</code>
              </pre>
              <p>
                Source builds need Node.js 24, npm, Rust 1.77+, and Tauri&apos;s platform
                prerequisites. See the{" "}
                <a href="https://github.com/Relic-a/Gretel#build-locally" rel="noreferrer">
                  project README
                </a>{" "}
                for platform details.
              </p>
            </div>
          </div>
        </section>

        <section className="closing">
          <div>
            <h2>Start with a feed that fits.</h2>
            <p>Free during the public beta. Your data stays yours, and it stays on your machine.</p>
          </div>
          <div className="closing-actions">
            <a className="button primary" href="#install">
              <Download size={18} aria-hidden="true" />
              Download Gretel
            </a>
            <a className="button ghost" href={ISSUES_URL} rel="noreferrer">Report an issue</a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
