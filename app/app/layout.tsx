import type { Metadata } from "next";
import { WindowTitleBar } from "../components/WindowTitleBar";
import { UpdateManager } from "../components/UpdateManager";

export const metadata: Metadata = {
  title: "Gretel",
  description: "Your local-first YouTube feed.",
  robots: { index: false, follow: false }
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WindowTitleBar />
      {children}
      <UpdateManager />
    </>
  );
}
