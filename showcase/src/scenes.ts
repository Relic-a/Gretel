// Scene plan for the Gretel showcase.
//
// Every scene plays a slice of one captured shot. `in`/`out` are frame numbers
// in the shot's normalized 30fps sequence (see capture/normalize.mjs) and
// `rate` compresses idle real time, so the edit is exact regardless of how long
// the original recording ran. The numbers come from the recorder's beat marks
// (logged by capture/capture.mjs).

export type Scene = {
  /** Folder name under public/captures. */
  shot: string;
  /** First frame of the shot's normalized sequence. */
  in: number;
  /** Last frame (exclusive). */
  out: number;
  /** Chapter label shown in the overlay rail. */
  chapter: string;
  /** Headline for the scene. */
  title: string;
  /** One-line supporting copy. */
  caption: string;
  /** Playback speed for the source frames; >1 compresses idle waiting. */
  rate?: number;
  /** How the scene enters. */
  transition?: "fade" | "slide-up";
};

export const FPS = 30;
export const WIDTH = 1440;
export const HEIGHT = 900;

export const INTRO_FRAMES = 108;
export const OUTRO_FRAMES = 150;

export const OUTRO_TEXT = {
  headline: "Feed yourself on purpose",
  subline:
    "Profiles, topics and channels — ranked locally with OpenRouter embeddings instead of watch time.",
  features: [
    "One profile per project",
    "Topics + channels",
    "Saved collections",
    "Playback queue",
    "Local SQLite",
    "Linux · Windows · macOS"
  ],
  callToAction: "Download the beta at github.com/Relic-a/Gretel"
};

export const scenes: Scene[] = [
  {
    shot: "01-wizard",
    in: 0,
    out: 210,
    rate: 1.35,
    chapter: "01 / SETUP",
    title: "Name a profile",
    caption: "Run one profile per project, mood or person.",
    transition: "fade"
  },
  {
    shot: "01-wizard",
    in: 210,
    out: 480,
    rate: 1.6,
    chapter: "02 / TOPICS",
    title: "Say what you are into",
    caption: "Topics become the search queries Gretel builds a pool from.",
    transition: "fade"
  },
  {
    shot: "01-wizard",
    in: 600,
    out: 1030,
    rate: 1.7,
    chapter: "03 / CHANNELS",
    title: "Seed it with channels",
    caption: "Search YouTube and subscribe without leaving Gretel.",
    transition: "slide-up"
  },
  {
    shot: "02-build",
    in: 40,
    out: 350,
    rate: 1.9,
    chapter: "04 / BUILD",
    title: "Gretel builds your feed",
    caption: "Candidates are crawled, embedded through OpenRouter, then ranked.",
    transition: "slide-up"
  },
  {
    shot: "02-build",
    in: 1240,
    out: 1560,
    rate: 2.6,
    chapter: "04 / BUILD",
    title: "Ranked, not guessed",
    caption: "Similarity scoring prunes duplicates and watched videos.",
    transition: "fade"
  },
  {
    shot: "03-feed",
    in: 0,
    out: 340,
    rate: 1.5,
    chapter: "05 / HOME",
    title: "A feed built only from your topics",
    caption: "No engagement traps, no unrelated recommendations.",
    transition: "fade"
  },
  {
    shot: "03-feed",
    in: 340,
    out: 575,
    rate: 1.7,
    chapter: "05 / HOME",
    title: "Save or queue in one tap",
    caption: "Actions live on the thumbnail so nothing interrupts browsing.",
    transition: "fade"
  },
  {
    shot: "04-watch",
    in: 60,
    out: 378,
    rate: 1.5,
    chapter: "06 / WATCH",
    title: "Watch and keep the signal",
    caption: "Saves, likes and watch history feed straight back into ranking.",
    transition: "slide-up"
  },
  {
    shot: "05-queue",
    in: 0,
    out: 213,
    rate: 1.4,
    chapter: "07 / QUEUE",
    title: "Line up what plays next",
    caption: "Reorder by drag or keyboard, then let autoplay take over.",
    transition: "fade"
  },
  {
    shot: "06-saved",
    in: 40,
    out: 400,
    rate: 1.7,
    chapter: "08 / SAVED",
    title: "Organise what matters",
    caption: "Group saves into collections, tag them, and add a note.",
    transition: "slide-up"
  },
  {
    shot: "06-saved",
    in: 560,
    out: 782,
    rate: 1.7,
    chapter: "08 / SAVED",
    title: "Filter without losing the thread",
    caption: "Collections stay scoped to a single profile.",
    transition: "fade"
  }
];

export function framesFor(scene: Scene) {
  return Math.round((scene.out - scene.in) / (scene.rate ?? 1));
}

export const sceneStarts = (() => {
  const starts: number[] = [];
  let cursor = INTRO_FRAMES;
  for (const scene of scenes) {
    starts.push(cursor);
    cursor += framesFor(scene);
  }
  return starts;
})();

export const SCENES_TOTAL = scenes.reduce((sum, scene) => sum + framesFor(scene), 0);
export const TOTAL_FRAMES = INTRO_FRAMES + SCENES_TOTAL + OUTRO_FRAMES;
export const DURATION_SECONDS = TOTAL_FRAMES / FPS;
