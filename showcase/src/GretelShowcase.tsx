import React from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import {
  FPS,
  HEIGHT,
  INTRO_FRAMES,
  OUTRO_FRAMES,
  OUTRO_TEXT,
  SCENES_TOTAL,
  TOTAL_FRAMES,
  WIDTH,
  framesFor,
  sceneStarts,
  scenes,
  type Scene
} from "./scenes";

const BRAND = "#e44232";
const BRAND_BRIGHT = "#ff5242";
const INK = "#0a0a0c";
const PAPER = "#e8e6e3";
const MUTED = "#8a8a8f";
const GRID = "rgba(255,255,255,0.05)";

const fontStack =
  "'Space Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** Background grid shared by every scene, so cuts feel like one product. */
const GridBackdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: INK,
      backgroundImage: `linear-gradient(${GRID} 1px, transparent 1px), linear-gradient(90deg, ${GRID} 1px, transparent 1px)`,
      backgroundSize: "40px 40px",
      fontFamily: fontStack,
      color: PAPER
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Red progress line that runs for the whole video. */
const ProgressRail: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, TOTAL_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 3,
        background: "rgba(255,255,255,0.07)"
      }}
    >
      <div style={{ height: "100%", width: `${progress * 100}%`, background: BRAND }} />
    </div>
  );
};

/** Persistent corner wordmark. */
const Wordmark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: 44,
      bottom: 34,
      display: "flex",
      alignItems: "center",
      gap: 11,
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: "0.04em"
    }}
  >
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: 30,
        height: 30,
        background: BRAND,
        color: "#fff",
        fontSize: 17
      }}
    >
      G
    </span>
    Gretel
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const title = spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 30 });
  const tagline = spring({ frame: frame - 26, fps, config: { damping: 200 }, durationInFrames: 30 });
  const line = interpolate(frame, [18, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease
  });
  const exit = interpolate(frame, [INTRO_FRAMES - 14, INTRO_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <GridBackdrop>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: exit }}>
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 104,
            height: 104,
            background: BRAND,
            color: "#fff",
            fontSize: 62,
            fontWeight: 700,
            transform: `scale(${mark})`,
            marginBottom: 34
          }}
        >
          G
        </div>
        <h1
          style={{
            fontSize: 92,
            margin: 0,
            letterSpacing: "-0.03em",
            transform: `translateY(${(1 - title) * 26}px)`,
            opacity: title
          }}
        >
          Gretel
        </h1>
        <div style={{ width: 420 * line, height: 4, background: BRAND_BRIGHT, margin: "28px 0 30px" }} />
        <p
          style={{
            fontSize: 27,
            color: MUTED,
            margin: 0,
            letterSpacing: "0.01em",
            opacity: tagline,
            transform: `translateY(${(1 - tagline) * 18}px)`
          }}
        >
          A YouTube feed you actually asked for
        </p>
      </AbsoluteFill>
    </GridBackdrop>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 34 });

  return (
    <GridBackdrop>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <h2
          style={{
            fontSize: 58,
            margin: 0,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 24}px)`
          }}
        >
          {OUTRO_TEXT.headline}
        </h2>
        <p style={{ color: MUTED, fontSize: 23, marginTop: 18, opacity: enter, maxWidth: 980 }}>
          {OUTRO_TEXT.subline}
        </p>
        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 42,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 1040
          }}
        >
          {OUTRO_TEXT.features.map((feature, index) => {
            const rowIn = spring({
              frame: frame - 22 - index * 6,
              fps,
              config: { damping: 200 },
              durationInFrames: 26
            });
            return (
              <span
                key={feature}
                style={{
                  border: "1px solid rgba(255,255,255,0.16)",
                  padding: "13px 20px",
                  fontSize: 19,
                  color: PAPER,
                  opacity: rowIn,
                  transform: `translateY(${(1 - rowIn) * 14}px)`
                }}
              >
                {feature}
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 46,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 21,
            color: MUTED,
            opacity: interpolate(frame, [58, 78], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp"
            })
          }}
        >
          <span style={{ color: BRAND_BRIGHT }}>&gt;</span> {OUTRO_TEXT.callToAction}
        </div>
      </AbsoluteFill>
    </GridBackdrop>
  );
};

/**
 * Plays one slice of a captured clip.
 *
 * The clip runs at the composition's frame rate, so a scene that starts at
 * source frame `in` is trimmed by that many frames and simply plays. `rate`
 * speeds up idle stretches by playing fewer source frames than output frames.
 */
const ShotPlayer: React.FC<{ scene: Scene; index: number; durationInFrames: number }> = ({
  scene,
  index,
  durationInFrames
}) => {
  const frame = useCurrentFrame();
  const rate = scene.rate ?? 1;
  const sourceSpan = scene.out - scene.in;

  // Gentle push so the UI recording has motion of its own.
  const push = interpolate(frame, [0, durationInFrames], [1.0, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  // With rate > 1 we step through keyframes so playback matches the edit.
  const speed = rate === 1 ? 1 : rate;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          boxShadow: "0 40px 120px rgba(0,0,0,0.65)"
        }}
      >
        <OffthreadVideo
          src={staticFile(`clips/${scene.shot}.mp4`)}
          trimBefore={scene.in}
          trimAfter={scene.out}
          playbackRate={speed}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${push})`
          }}
        />
        <ShotVeil />
      </div>
      <SceneChrome scene={scene} index={index} durationInFrames={durationInFrames} />
    </AbsoluteFill>
  );
};

/** Slight vignette so the overlay copy stays legible over bright frames. */
const ShotVeil: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(10,10,12,0.62) 0%, rgba(10,10,12,0.12) 26%, rgba(10,10,12,0) 46%, rgba(10,10,12,0.55) 100%)"
    }}
  />
);

const SceneChrome: React.FC<{ scene: Scene; index: number; durationInFrames: number }> = ({
  scene,
  index,
  durationInFrames
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inSpring = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const outFade = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 44,
          top: 40,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: inSpring * outFade,
          transform: `translateY(${(1 - inSpring) * -12}px)`
        }}
      >
        <span style={{ fontSize: 14, letterSpacing: "0.22em", color: BRAND_BRIGHT }}>
          {scene.chapter}
        </span>
        <span style={{ width: 46, height: 1, background: "rgba(255,255,255,0.28)" }} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 44,
          bottom: 100,
          maxWidth: 900,
          opacity: inSpring * outFade,
          transform: `translateY(${(1 - inSpring) * 20}px)`
        }}
      >
        <h2 style={{ fontSize: 46, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          {scene.title}
        </h2>
        <p style={{ fontSize: 21, color: "#b6b4b2", marginTop: 12, marginBottom: 0 }}>
          {scene.caption}
        </p>
      </div>

      <ChapterTicks activeIndex={index} />
    </>
  );
};

/** Top-right chapter ticks that show progress through the tour. */
const ChapterTicks: React.FC<{ activeIndex: number }> = ({ activeIndex }) => (
  <div style={{ position: "absolute", right: 44, top: 38, display: "flex", gap: 7 }}>
    {scenes.map((scene, index) => (
      <span
        key={`${scene.chapter}-${scene.in}`}
        style={{
          width: index === activeIndex ? 26 : 10,
          height: 4,
          background: index <= activeIndex ? BRAND : "rgba(255,255,255,0.18)"
        }}
      />
    ))}
  </div>
);

/** Crossfade / slide wrapper for a scene. */
const SceneTransition: React.FC<{
  scene: Scene;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ scene, durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const kind = scene.transition ?? "fade";
  const enterDuration = 13;
  const exitDuration = 11;

  const enter = interpolate(frame, [0, enterDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease
  });
  const exit = interpolate(frame, [durationInFrames - exitDuration, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease
  });

  const style: React.CSSProperties = { opacity: Math.min(enter, exit) };
  if (kind === "slide-up") {
    style.transform = `translateY(${(1 - enter) * 46}px)`;
  }

  return (
    <AbsoluteFill style={style}>
      {children}
      <AbsoluteFill style={{ background: INK, opacity: 1 - Math.min(enter, exit) }} />
    </AbsoluteFill>
  );
};

const Showcase: React.FC = () => {
  return (
    <GridBackdrop>
      <Sequence durationInFrames={INTRO_FRAMES} name="Intro">
        <Intro />
      </Sequence>

      {scenes.map((scene, index) => {
        const durationInFrames = framesFor(scene);
        return (
          <Sequence
            key={`${scene.shot}-${scene.in}`}
            from={sceneStarts[index]}
            durationInFrames={durationInFrames}
            name={`${scene.chapter} ${scene.title}`}
          >
            <SceneTransition scene={scene} durationInFrames={durationInFrames}>
              <ShotPlayer scene={scene} index={index} durationInFrames={durationInFrames} />
            </SceneTransition>
          </Sequence>
        );
      })}

      <Sequence from={INTRO_FRAMES + SCENES_TOTAL} durationInFrames={OUTRO_FRAMES} name="Outro">
        <Outro />
      </Sequence>

      <ProgressRail />
      <Wordmark />
    </GridBackdrop>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="GretelShowcase"
    component={Showcase}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
