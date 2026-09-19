import { UpdateManager } from "../components/UpdateManager";
import { WindowTitleBar } from "../components/WindowTitleBar";

/** Diagnostics is part of the desktop app, so it keeps the custom title bar. */
export default function DiagnosticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WindowTitleBar />
      {children}
      <UpdateManager />
    </>
  );
}
