import type { Metadata } from "next";
import "./styles.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
