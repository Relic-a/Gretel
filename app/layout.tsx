import type { Metadata } from "next";
import "./base.css";
import { siteUrl } from "./site";

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: {
    default: "Gretel · A YouTube feed you actually chose",
    template: "%s"
  },
  description: "Describe the YouTube feed you want and Gretel curates it.",
  applicationName: "Gretel"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
