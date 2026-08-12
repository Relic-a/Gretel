import type { Metadata } from "next";
import localFont from "next/font/local";
import "./styles.css";

const spaceMono = localFont({
  src: [
    { path: "./fonts/space-mono-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/space-mono-bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/space-mono-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/space-mono-bold-italic.woff2", weight: "700", style: "italic" }
  ],
  display: "swap",
  variable: "--font-space-mono"
});

export const metadata: Metadata = {
  title: "Gretel",
  description: "Describe the YouTube feed you want and Gretel curates it."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={spaceMono.variable}>
      <body>{children}</body>
    </html>
  );
}
