// Scene boundaries follow words in one continuous Rufus narration.
// Source speech timestamps were measured with faster-whisper; the whole take
// plays at 0.9x, preserving pauses and pitch. No scene-by-scene audio edits.
export const FPS = 60;
export const WIDTH = 2880;
export const HEIGHT = 1920;
export const VOICE_SPEED = 0.9;
export const VOICE_LEAD_SECONDS = 0.2;
export const VOICE_DURATION_SECONDS = 50.478;
const at = (seconds: number) => Math.round((seconds / VOICE_SPEED + VOICE_LEAD_SECONDS) * FPS);
export type Scene = {
  shot: string;
  title: string;
  caption: string;
  start: number;
  end: number;
  lead: number;
};
export const INTRO_FRAMES = at(3.5);
export const TOTAL_FRAMES = Math.ceil((VOICE_DURATION_SECONDS / VOICE_SPEED + VOICE_LEAD_SECONDS + 0.8) * FPS);
export const scenes: Scene[] = [
  { shot: "v2-name", title: "Name a profile", caption: "Creative Coding", start: at(3.5), end: at(9.24), lead: 0.6 },
  { shot: "v2-topics", title: "Add topics", caption: "Web design · Generative art · WebGL", start: at(9.24), end: at(14.6), lead: 0.4 },
  { shot: "v2-channels", title: "Add a channel", caption: "The Coding Train", start: at(14.6), end: at(21.2), lead: 0.3 },
  { shot: "v2-feed", title: "Browse the feed", caption: "Save for later or add to the queue", start: at(21.2), end: at(26.8), lead: 0.9 },
  { shot: "v2-watch", title: "Watch a video", caption: "Player, details, and up next",
    start: at(26.8), end: at(33.36), lead: 0 },
  { shot: "v2-queue", title: "Change the queue order", caption: "Choose what plays next",
    start: at(33.36), end: at(38.2), lead: 1.4 },
  { shot: "v2-saved", title: "Organize saved videos", caption: "Keep related videos in a collection",
    start: at(38.2), end: at(43.62), lead: 0.3 }
];
export const framesFor = (scene: Scene) => scene.end - scene.start;
export const sceneStarts = scenes.map(scene => scene.start);
export const SCENES_TOTAL = scenes.at(-1)!.end - INTRO_FRAMES;
export const OUTRO_FRAMES = TOTAL_FRAMES - INTRO_FRAMES - SCENES_TOTAL;
export const DURATION_SECONDS = TOTAL_FRAMES / FPS;
