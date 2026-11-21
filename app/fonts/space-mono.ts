import localFont from "next/font/local";

export const spaceMono = localFont({
  src: [
    { path: "./space-mono-regular.woff2", weight: "400", style: "normal" },
    { path: "./space-mono-bold.woff2", weight: "700", style: "normal" },
    { path: "./space-mono-italic.woff2", weight: "400", style: "italic" },
    { path: "./space-mono-bold-italic.woff2", weight: "700", style: "italic" }
  ],
  display: "swap",
  variable: "--font-space-mono"
});
