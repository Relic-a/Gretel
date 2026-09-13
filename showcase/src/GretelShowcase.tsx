import React from "react";
import { AbsoluteFill, Composition, OffthreadVideo, Sequence, staticFile } from "remotion";
import { FPS, WIDTH, HEIGHT, INTRO_FRAMES, OUTRO_FRAMES, TOTAL_FRAMES, SCENES_TOTAL,
  scenes, sceneStarts, framesFor, type Scene } from "./scenes";
import { Cursor } from "./Cursor";

const fontFamily = "'Space Mono', monospace";
const background = "#101010";
const Title: React.FC<{ closing?: boolean }> = ({ closing = false }) => (
  <AbsoluteFill style={{ background, color: "#eee", fontFamily, justifyContent: "center", alignItems: "center" }}>
    <div style={{ color: "#e44232", fontSize: 144, fontWeight: 700, letterSpacing: 8 }}>GRETEL</div>
    <div style={{ fontSize: 44, marginTop: 32, color: "#c3c3c3" }}>
      {closing ? "Topics. Profiles. Saved videos." : "A YouTube feed around your interests."}
    </div>
    {closing && <div style={{ fontSize: 32, marginTop: 72, color: "#aaa" }}>github.com/Relic-a/Gretel</div>}
  </AbsoluteFill>
);
const Shot: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => (
  <AbsoluteFill style={{ background, fontFamily, color: "#eee" }}>
    {/* App pixels stay at 1:1. Nothing is painted over the application. */}
    <OffthreadVideo src={staticFile(`clips/${scene.shot}.mp4`)} muted
      style={{ position: "absolute", top: 0, left: 0, width: 2880, height: 1800, objectFit: "contain" }} />
    <Cursor scene={scene} />
    <div style={{ position: "absolute", top: 1800, left: 0, right: 0, height: 120,
      borderTop: "2px solid #333", display: "flex", alignItems: "center",
      justifyContent: "space-between", padding: "0 48px", background }}>
      <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
        <span style={{ color: "#ef6556", fontSize: 26 }}>{String(index + 1).padStart(2, "0")}</span>
        <span style={{ fontSize: 34 }}>{scene.title}</span>
      </div>
      <span style={{ color: "#aaa", fontSize: 27 }}>{scene.caption}</span>
    </div>
  </AbsoluteFill>
);
const Showcase: React.FC = () => (
  <AbsoluteFill style={{ background }}>
    <Sequence durationInFrames={INTRO_FRAMES}><Title /></Sequence>
    {scenes.map((scene, index) => (
      <Sequence key={scene.shot} from={sceneStarts[index]} durationInFrames={framesFor(scene)} name={scene.title}>
        <Shot scene={scene} index={index} />
      </Sequence>
    ))}
    <Sequence from={INTRO_FRAMES + SCENES_TOTAL} durationInFrames={OUTRO_FRAMES}><Title closing /></Sequence>
  </AbsoluteFill>
);
export const RemotionRoot: React.FC = () => (
  <Composition id="GretelShowcase" component={Showcase} durationInFrames={TOTAL_FRAMES}
    fps={FPS} width={WIDTH} height={HEIGHT} />
);
