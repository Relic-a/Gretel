"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type FeedBuildProgressProps = {
  profileName?: string;
  tags?: string[];
  channels?: string[];
  variant?: "full" | "compact";
  loadingLabel?: string;
};

type BuildPhase = {
  id: number;
  label: string;
  title: string;
  detail: string;
  startThreshold: number;
};

const BUILD_PHASES: BuildPhase[] = [
  {
    id: 1,
    label: "01",
    title: "Initializing Seeds",
    detail: "Compiling search queries for chosen topics & channels",
    startThreshold: 0
  },
  {
    id: 2,
    label: "02",
    title: "Scanning YouTube Index",
    detail: "Fetching candidate videos & creator channel uploads",
    startThreshold: 22
  },
  {
    id: 3,
    label: "03",
    title: "AI Semantic Embeddings",
    detail: "Measuring vector similarity to match your precise topics",
    startThreshold: 48
  },
  {
    id: 4,
    label: "04",
    title: "Traversing Topic Graph",
    detail: "Expanding seed clusters to find deeper related recommendations",
    startThreshold: 72
  },
  {
    id: 5,
    label: "05",
    title: "Curating & Ranking Feed",
    detail: "Pruning duplicates, filtering watched items & ordering your stream",
    startThreshold: 88
  }
];

const INSIGHTS = [
  "Gretel builds your feed directly from your chosen topics — avoiding engagement traps.",
  "OpenRouter embeddings score candidate video relevance against your profile.",
  "Channel uploads are blended directly into your personalized candidate pool.",
  "Watched videos and dismissed items are automatically filtered from your stream.",
  "Building an independent discovery graph tailored to your taste..."
];

function calculateProgress(elapsedSec: number): number {
  if (elapsedSec < 1.5) {
    return Math.min(22, (elapsedSec / 1.5) * 22);
  } else if (elapsedSec < 4.5) {
    const t = (elapsedSec - 1.5) / 3.0;
    return 22 + t * (48 - 22);
  } else if (elapsedSec < 8.0) {
    const t = (elapsedSec - 4.5) / 3.5;
    return 48 + t * (72 - 48);
  } else if (elapsedSec < 12.5) {
    const t = (elapsedSec - 8.0) / 4.5;
    return 72 + t * (88 - 72);
  } else if (elapsedSec < 20.0) {
    const t = (elapsedSec - 12.5) / 7.5;
    return 88 + t * (96 - 88);
  } else {
    const extra = elapsedSec - 20;
    return Math.min(98, 96 + (1 - Math.exp(-extra / 15)) * 2);
  }
}

export function FeedBuildProgress({
  profileName,
  tags = [],
  channels = [],
  variant = "full",
  loadingLabel
}: FeedBuildProgressProps) {
  const startTimeRef = useRef<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    startTimeRef.current = Date.now();
    setElapsedSec(0);

    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = (now - startTimeRef.current) / 1000;
      setElapsedSec(elapsed);
    }, 100);

    return () => window.clearInterval(interval);
  }, []);

  const progress = calculateProgress(elapsedSec);
  const roundedPercent = Math.min(99, Math.max(1, Math.round(progress)));

  const currentPhaseIndex = useMemo(() => {
    let index = 0;
    for (let i = 0; i < BUILD_PHASES.length; i++) {
      if (progress >= BUILD_PHASES[i].startThreshold) {
        index = i;
      }
    }
    return index;
  }, [progress]);

  const activePhase = BUILD_PHASES[currentPhaseIndex];
  const insightIndex = Math.floor(elapsedSec / 3.8) % INSIGHTS.length;
  const formattedSeconds = Math.floor(elapsedSec);
  const formattedTime = `${Math.floor(formattedSeconds / 60)}:${String(formattedSeconds % 60).padStart(2, "0")}s`;

  if (variant === "compact") {
    return (
      <div className="feed-build-compact" role="status" aria-live="polite">
        <div className="feed-build-compact-head">
          <div className="feed-build-status-badge">
            <span className="live-dot" aria-hidden="true" />
            <span>{loadingLabel || "Building Feed"}</span>
          </div>
          <span className="feed-build-timer">{formattedTime}</span>
        </div>

        <div
          className="feed-build-progress-bar"
          role="progressbar"
          aria-valuenow={roundedPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="feed-build-progress-fill"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        </div>

        <div className="feed-build-compact-info">
          <div className="compact-phase-title">
            <span className="phase-num">[{activePhase.label}]</span>{" "}
            <strong>{activePhase.title}</strong>
          </div>
          <p className="compact-phase-detail">{activePhase.detail}...</p>
        </div>

        <div className="feed-build-compact-insight">
          <span className="insight-spark" aria-hidden="true">✦</span>
          <span>{INSIGHTS[insightIndex]}</span>
        </div>
      </div>
    );
  }

  return (
    <section className="feed-build-container" role="status" aria-live="polite">
      <div className="feed-build-header">
        <div className="feed-build-meta-left">
          <div className="feed-build-status-badge">
            <span className="live-dot" aria-hidden="true" />
            <span>SYNTHESIZING FEED</span>
          </div>
          {profileName && (
            <div className="feed-build-profile-pill">
              <span className="profile-avatar tiny" aria-hidden="true" />
              <span>{profileName}</span>
            </div>
          )}
          {(tags.length > 0 || channels.length > 0) && (
            <div className="feed-build-tag-list">
              {tags.slice(0, 4).map((tag) => (
                <span className="seed-tag" key={tag}>
                  #{tag}
                </span>
              ))}
              {channels.slice(0, 2).map((channel) => (
                <span className="seed-channel" key={channel}>
                  @{channel}
                </span>
              ))}
              {tags.length + channels.length > 6 && (
                <span className="seed-tag-more">+{tags.length + channels.length - 6} more</span>
              )}
            </div>
          )}
        </div>

        <div className="feed-build-meta-right">
          <span className="feed-build-timer">⏱ {formattedTime}</span>
          <span className="feed-build-percent">{roundedPercent}%</span>
        </div>
      </div>

      <div
        className="feed-build-progress-bar"
        role="progressbar"
        aria-valuenow={roundedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="feed-build-progress-fill"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      </div>

      <div className="feed-build-active-hero">
        <div className="active-hero-badge">
          PHASE {activePhase.label} OF 05
        </div>
        <h2 className="active-hero-title">
          {activePhase.title}
          <span className="animated-ellipsis" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </h2>
        <p className="active-hero-detail">{activePhase.detail}</p>
      </div>

      <div className="feed-build-pipeline" aria-label="Build stages">
        {BUILD_PHASES.map((phase, index) => {
          const isDone = index < currentPhaseIndex;
          const isCurrent = index === currentPhaseIndex;

          return (
            <div
              key={phase.id}
              className={`pipeline-step ${isDone ? "done" : isCurrent ? "active" : "upcoming"}`}
            >
              <div className="pipeline-step-header">
                <span className="pipeline-step-dot" aria-hidden="true">
                  {isDone ? "✓" : isCurrent ? "▶" : phase.label}
                </span>
                <span className="pipeline-step-label">{phase.label}</span>
              </div>
              <strong className="pipeline-step-title">{phase.title}</strong>
              <p className="pipeline-step-desc">{phase.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="feed-build-footer">
        <div className="feed-build-insight">
          <span className="insight-spark" aria-hidden="true">✦</span>
          <span className="insight-text">{INSIGHTS[insightIndex]}</span>
        </div>
      </div>
    </section>
  );
}
