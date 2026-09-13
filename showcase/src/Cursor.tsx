import React from "react";
import { useCurrentFrame } from "remotion";
import { FPS, type Scene } from "./scenes";
import name from "./pointers/v2-name.json";
import topics from "./pointers/v2-topics.json";
import channels from "./pointers/v2-channels.json";
import feed from "./pointers/v2-feed.json";
import watch from "./pointers/v2-watch.json";
import queue from "./pointers/v2-queue.json";
import saved from "./pointers/v2-saved.json";
type Point = { x: number; y: number; t: number; click: boolean };
type Track = { rate: number; points: Point[] };
const tracks: Record<string, Track> = {
  "v2-name": name, "v2-topics": topics, "v2-channels": channels,
  "v2-feed": feed, "v2-watch": watch, "v2-queue": queue, "v2-saved": saved
};
// Pointer motion is rendered at the output's 60 fps from real mouse events.
// It no longer depends on how frequently CDP emits an application frame.
export const Cursor: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { points, rate } = tracks[scene.shot];
  const time = Math.max(0, (frame / FPS - scene.lead) * rate);
  let index = 0;
  while (index + 1 < points.length && points[index + 1].t <= time) index++;
  const a = points[index];
  const b = points[Math.min(index + 1, points.length - 1)];
  const fraction = b.t > a.t ? Math.min(1, Math.max(0, (time - a.t) / (b.t - a.t))) : 0;
  const x = a.x + (b.x - a.x) * fraction;
  const y = a.y + (b.y - a.y) * fraction;
  const click = points.slice(0, index + 1).reverse().find(point => point.click);
  const age = click ? time - click.t : 1;
  const radius = 16 + age * 70;
  return <div style={{ position: "absolute", inset: "0 0 120px 0", overflow: "hidden", pointerEvents: "none" }}>
    {click && age >= 0 && age < 0.3 && <div style={{ position: "absolute",
      left: click.x - radius, top: click.y - radius, width: radius * 2, height: radius * 2,
      border: "3px solid #ef6556", borderRadius: "50%", opacity: 0.65 * (1 - age / 0.3) }} />}
    <svg width="44" height="44" viewBox="0 0 22 22" style={{
      position: "absolute", left: x - 8, top: y - 5, filter: "drop-shadow(0 2px 2px #0008)"
    }}><path d="M4 2.6 17.2 11.1l-5.6 1.1-2.7 5.2z" fill="white" stroke="#111" strokeWidth="1.2" /></svg>
  </div>;
};
