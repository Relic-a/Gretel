"use client";

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

export function WindowTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    document.documentElement.classList.add("tauri-app");
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncMaximized = () => {
      void appWindow.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      });
    };

    syncMaximized();
    void appWindow.onResized(syncMaximized).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });

    return () => {
      disposed = true;
      unlisten?.();
      document.documentElement.classList.remove("tauri-app");
    };
  }, []);

  function runWindowAction(action: () => Promise<void>) {
    if (isTauri()) void action();
  }

  return (
    <div className="window-titlebar" data-tauri-drag-region>
      <div
        className="window-drag-region"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button === 0 && event.detail === 1) {
            runWindowAction(() => getCurrentWindow().startDragging());
          }
        }}
        onDoubleClick={() => runWindowAction(() => getCurrentWindow().toggleMaximize())}
      >
        <span className="window-app-mark" aria-hidden="true">G</span>
        <span className="window-title">Gretel</span>
      </div>
      <div className="window-controls" aria-label="Window controls">
        <button
          type="button"
          className="window-control"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => runWindowAction(() => getCurrentWindow().minimize())}
        >
          <Minus aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => runWindowAction(() => getCurrentWindow().toggleMaximize())}
        >
          {maximized ? <span className="restore-icon" aria-hidden="true" /> : <Square aria-hidden="true" size={12} strokeWidth={1.7} />}
        </button>
        <button
          type="button"
          className="window-control close"
          aria-label="Close"
          title="Close"
          onClick={() => runWindowAction(() => getCurrentWindow().close())}
        >
          <X aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
