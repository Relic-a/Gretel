"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

type UpdateStatus = "idle" | "available" | "downloading" | "ready" | "error";

type AvailableUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: (progress?: (event: UpdateDownloadEvent) => void) => Promise<void>;
  close: () => Promise<void>;
};

type UpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export function UpdateManager() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const checked = useRef(false);

  const checkForUpdate = useCallback(async (showNoUpdate = false) => {
    try {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;

      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (!found) {
        if (showNoUpdate) {
          setMessage("Gretel is up to date.");
          window.setTimeout(() => setMessage(""), 3000);
        }
        return;
      }

      setUpdate(found as AvailableUpdate);
      setStatus("available");
      setMessage("");
    } catch (error) {
      console.error("Could not check for Gretel updates", error);
      if (showNoUpdate) {
        setStatus("error");
        setMessage("Could not check for updates. Try again later.");
      }
    }
  }, []);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const timer = window.setTimeout(() => void checkForUpdate(), 4000);
    return () => window.clearTimeout(timer);
  }, [checkForUpdate]);

  useEffect(() => {
    const listener = () => void checkForUpdate(true);
    window.addEventListener("gretel:check-for-updates", listener);
    return () => window.removeEventListener("gretel:check-for-updates", listener);
  }, [checkForUpdate]);

  async function installUpdate() {
    if (!update) return;
    setStatus("downloading");
    setMessage("");
    let downloaded = 0;
    let total = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
          setProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        } else {
          setProgress(100);
          setStatus("ready");
        }
      });

      setStatus("ready");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      console.error("Could not install Gretel update", error);
      setStatus("error");
      setMessage("The update could not be installed. Your current version is unchanged.");
    }
  }

  async function dismiss() {
    await update?.close().catch(() => undefined);
    setUpdate(null);
    setStatus("idle");
    setMessage("");
  }

  if (status === "idle" && !message) return null;

  return (
    <aside className="update-toast" aria-live="polite" aria-label="Gretel update">
      <div className="update-toast-copy">
        <strong>
          {status === "available" && `Gretel ${update?.version} is available`}
          {status === "downloading" && "Downloading update"}
          {status === "ready" && "Restarting Gretel"}
          {status === "error" && "Update failed"}
          {status === "idle" && message}
        </strong>
        {status === "available" && <span>The update installs inside Gretel and preserves your local data.</span>}
        {status === "downloading" && <span>{progress > 0 ? `${progress}% complete` : "Preparing download…"}</span>}
        {status === "ready" && <span>The new version has been installed.</span>}
        {status === "error" && <span>{message}</span>}
      </div>
      {status === "downloading" && <progress max="100" value={progress} aria-label="Update download progress" />}
      <div className="update-toast-actions">
        {status === "available" && (
          <button type="button" onClick={() => void installUpdate()}>
            <Download aria-hidden="true" size={16} /> Update and restart
          </button>
        )}
        {status === "error" && (
          <button type="button" onClick={() => void checkForUpdate(true)}>
            <RefreshCw aria-hidden="true" size={16} /> Retry
          </button>
        )}
        {status !== "downloading" && status !== "ready" && (
          <button type="button" className="update-dismiss" onClick={() => void dismiss()} aria-label="Dismiss update message">
            <X aria-hidden="true" size={17} />
          </button>
        )}
      </div>
    </aside>
  );
}
